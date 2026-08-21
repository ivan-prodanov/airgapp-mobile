package expo.modules.passiveentry

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Android counterpart of `ios/PassiveEntryCentral.swift` — the GATT central that holds the link
 * to the car.
 *
 * SCOPE: foreground **pipe mode** only. Native moves bytes; every scrap of Tesla protocol and
 * crypto stays in TypeScript (`src/ble/`, 956 node tests), exactly as on iOS. Native does NO
 * reassembly — it forwards each raw 0213 notification and writes what TS hands it. Background
 * self-signing (VcsecSigner / CarRegionMonitor) is Phase 4.
 *
 * Three Android-specific hazards the iOS version never had to deal with:
 *
 *  1. **The CCCD write.** `setCharacteristicNotification` only flips a local flag. Without also
 *     writing ENABLE_NOTIFICATION_VALUE to descriptor 0x2902, the car is never told to notify
 *     and 0213 stays silent forever — with no error anywhere.
 *  2. **One GATT operation at a time.** Android's stack has a single in-flight slot per
 *     connection; issuing a write before the previous `onCharacteristicWrite` lands silently
 *     drops it. Writes are therefore queued and pumped one at a time.
 *  3. **MTU is negotiated explicitly** and only after connect. iOS hands you
 *     `maximumWriteValueLength`; here we must call `requestMtu` and wait for `onMtuChanged`
 *     before discovering services, or the first writes get chopped to 20 bytes.
 */
class PassiveEntryCentral(private val context: Context) {

  companion object {
    val SERVICE_UUID: UUID = UUID.fromString("00000211-b2d1-43f0-9b88-960cebf8b91e")
    val TX_UUID: UUID = UUID.fromString("00000212-b2d1-43f0-9b88-960cebf8b91e") // write
    val RX_UUID: UUID = UUID.fromString("00000213-b2d1-43f0-9b88-960cebf8b91e") // notify
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /**
     * The car ADVERTISES the 16-bit service UUID 1122 (confirmed on-car 2026-07-22:
     * `advServices=[1122]`), NOT the full GATT service 00000211. This is the scan filter; 00000211
     * is only what we read/write characteristics on once connected.
     */
    val ADVERTISED_SERVICE: ParcelUuid = ParcelUuid.fromString("00001122-0000-1000-8000-00805f9b34fb")

    private const val DEFAULT_MTU = 23
    private const val REQUESTED_MTU = 517
    private const val RECONNECT_DELAY_MS = 2_000L

    /**
     * How long one scan window lasts before we give up and report it.
     *
     * A scan MUST be bounded. Android progressively throttles long-running scans and, past
     * roughly half an hour, quietly stops delivering results altogether — the scanner still looks
     * alive, it just never calls back. An unbounded scan therefore degrades into a permanent
     * no-op that is indistinguishable from "no car nearby". 20s matches the JS connect budget in
     * BridgedBleTransport, so the two time out together instead of the TS side blaming a scan
     * that had silently stopped working.
     */
    private const val SCAN_WINDOW_MS = 20_000L
  }

  var onLog: ((String) -> Unit)? = null
  var onFrame: ((ByteArray) -> Unit)? = null
  var onConnectionState: ((String, Int) -> Unit)? = null

  @Volatile var isRunning: Boolean = false
    private set

  private var foregroundActive: Boolean = true
  private var targetName: String? = null
  private var gatt: BluetoothGatt? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var rxChar: BluetoothGattCharacteristic? = null
  private var mtu: Int = DEFAULT_MTU
  private var scanning = false

  private val main = Handler(Looper.getMainLooper())
  /** Distinct advertisers seen in the current scan window, for the end-of-window diagnostic. */
  private val seenThisWindow = linkedSetOf<String>()
  /** elapsedRealtime when the live scan window opened; 0 when no scan is running. */
  private var scanStartedAt = 0L
  private val writeQueue = ConcurrentLinkedQueue<ByteArray>()
  private var writeInFlight = false

  private val adapter: BluetoothAdapter?
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun log(line: String) {
    onLog?.invoke(line)
    android.util.Log.i("PassiveEntry", line)
  }

  /** blockLength is what TS seeds from `mtu - 3`; keep the two definitions in lockstep. */
  private val blockLength: Int get() = (mtu - 3).coerceAtLeast(20)

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Arm the central for `vin`. Idempotent: re-arming for the same VIN while connected is a no-op,
   * which matters because both useCarLink's foreground lifecycle and BridgedBleTransport.openSession
   * call it.
   */
  @SuppressLint("MissingPermission")
  fun start(vin: String) {
    val name = vehicleLocalName(vin)
    // Two ways to get this wrong, and we hit both on 2026-08-21:
    //
    //   Swallow too much — the original check treated "scanning" as "already running" with no
    //   expiry, so a scan begun 30 minutes earlier still counted. Android stops delivering
    //   results for long-running scans with no signal at all, so the enrol attempt at the car
    //   timed out against a dead scanner and reported "car asleep/out of range" without ever
    //   having looked.
    //
    //   Swallow too little — dropping the check entirely restarted the scan on every call, and
    //   useCarLink polls start() about every 6s. Android blocks an app that starts 5 scans in
    //   30s (SCAN_FAILED_SCANNING_TOO_FREQUENTLY), which would have been the same silent
    //   emptiness by a different route.
    //
    // So: a live link is idempotent, and a scan is idempotent only while its window is still
    // open. An expired window restarts.
    if (isRunning && targetName == name) {
      if (gatt != null) {
        log("start($name) — link already up")
        return
      }
      val age = android.os.SystemClock.elapsedRealtime() - scanStartedAt
      if (scanning && age < SCAN_WINDOW_MS) {
        return // window still open; say nothing, this is polled
      }
    }
    targetName = name
    log("start vin=${vin.takeLast(6)} localName=$name")
    if (!BleGuards.hasScanPermissions(context)) {
      isRunning = false
      log("MISSING BLE runtime permissions — scan would return zero results silently; aborting. " +
        "Grant them and start again.")
      reportState()
      return
    }
    if (adapter?.isEnabled != true) {
      isRunning = false
      log("Bluetooth is OFF — cannot scan. Enable it and start again.")
      reportState()
      return
    }
    isRunning = true
    beginScan()
  }

  @SuppressLint("MissingPermission")
  fun stop() {
    log("stop")
    isRunning = false
    targetName = null
    stopScan()
    gatt?.let {
      runCatching { it.disconnect() }
      runCatching { it.close() }
    }
    gatt = null
    txChar = null
    rxChar = null
    mtu = DEFAULT_MTU
    writeQueue.clear()
    writeInFlight = false
    reportState()
  }

  fun setForegroundResponderActive(active: Boolean) {
    foregroundActive = active
    log("foregroundActive=$active")
  }

  // ── scanning ───────────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun beginScan() {
    val scanner = adapter?.bluetoothLeScanner ?: run { log("no BLE scanner"); return }
    if (scanning) return
    scanning = true
    // NO ScanFilter, deliberately.
    //
    // iOS filters on the advertised 16-bit service 1122 because CoreBluetooth FORBIDS a nil-scan
    // in the background. Android has no such rule for a foreground scan, and a filter here buys
    // nothing while risking everything: if the car's advertisement does not carry that service
    // UUID in the exact form ScanFilter matches, the car is dropped before onScanResult and the
    // failure is indistinguishable from "no car nearby". Matching on the VIN-derived local name
    // (which is authoritative, and cross-checked byte-for-byte against bleScanName.ts) is both
    // stricter and more robust. Unfiltered also means the end-of-window diagnostic can report
    // what WAS advertising, which is the difference between a sleeping car and a bad filter.
    //
    // Phase 4's background scan will need a filter — revisit this there, with the advertisement
    // actually captured from the car rather than assumed.
    val filters = emptyList<ScanFilter>()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    seenThisWindow.clear()
    scanStartedAt = android.os.SystemClock.elapsedRealtime()
    log("scanning for $targetName (unfiltered), ${SCAN_WINDOW_MS}ms window")
    runCatching { scanner.startScan(filters, settings, scanCallback) }
      .onFailure { log("startScan threw: ${it.message}"); scanning = false; return }
    main.postDelayed(scanTimeout, SCAN_WINDOW_MS)
  }

  /**
   * Ends the window and says what was actually seen. Reporting the observed device list is the
   * difference between "the car is asleep" and "we were filtering it out" — two failures that
   * look identical from the TS side.
   */
  private val scanTimeout = Runnable {
    if (!scanning) return@Runnable
    stopScan()
    log(
      if (seenThisWindow.isEmpty()) {
        "scan window ended — NOTHING advertising at all nearby (Bluetooth off? car asleep?)"
      } else {
        "scan window ended — saw ${seenThisWindow.size} advertiser(s) " +
          "[${seenThisWindow.joinToString(", ")}] but none named $targetName"
      },
    )
    reportState()
  }

  @SuppressLint("MissingPermission")
  private fun stopScan() {
    if (!scanning) return
    scanning = false
    scanStartedAt = 0L
    main.removeCallbacks(scanTimeout)
    runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
  }

  private val scanCallback = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val advName = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull()
      val want = targetName ?: return
      if (advName != want) {
        // Record rather than drop: if the car is advertising under a name we do not expect, the
        // window summary shows it instead of us reporting a bare "nothing found".
        seenThisWindow.add(advName ?: "(unnamed ${result.device.address})")
        return
      }
      log("discovered $advName rssi=${result.rssi} → connecting")
      stopScan()
      connect(result.device)
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      val why = when (errorCode) {
        1 -> "ALREADY_STARTED"
        2 -> "APPLICATION_REGISTRATION_FAILED"
        3 -> "INTERNAL_ERROR"
        4 -> "FEATURE_UNSUPPORTED"
        // The throttle: 5 scan starts within 30s blocks the app for the next 30s.
        6 -> "SCANNING_TOO_FREQUENTLY — backing off"
        else -> "unknown"
      }
      log("scan FAILED code=$errorCode ($why)")
    }
  }

  // ── connection ─────────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun connect(device: BluetoothDevice) {
    gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
  }

  private val gattCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        log("CONNECTED — requesting MTU $REQUESTED_MTU")
        // MTU BEFORE service discovery: the negotiated value decides our write chunk size, and
        // a late change would resize blockLength under TS mid-exchange.
        if (!g.requestMtu(REQUESTED_MTU)) {
          log("requestMtu refused — continuing at $DEFAULT_MTU")
          g.discoverServices()
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        log("DISCONNECTED status=$status")
        txChar = null
        rxChar = null
        mtu = DEFAULT_MTU
        writeQueue.clear()
        writeInFlight = false
        runCatching { g.close() }
        gatt = null
        reportState()
        // The car drops the link constantly (sleep, range). Re-acquire while armed.
        if (isRunning) main.postDelayed({ if (isRunning) beginScan() }, RECONNECT_DELAY_MS)
      }
    }

    @SuppressLint("MissingPermission")
    override fun onMtuChanged(g: BluetoothGatt, negotiated: Int, status: Int) {
      mtu = if (status == BluetoothGatt.GATT_SUCCESS) negotiated else DEFAULT_MTU
      log("MTU=$mtu (blockLength=$blockLength) — discovering services")
      g.discoverServices()
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val svc = g.getService(SERVICE_UUID) ?: run {
        log("no VCSEC service 00000211 on this peripheral")
        return
      }
      txChar = svc.getCharacteristic(TX_UUID)
      rxChar = svc.getCharacteristic(RX_UUID)
      val rx = rxChar
      if (txChar == null || rx == null) {
        log("missing tx/rx characteristic")
        return
      }
      g.setCharacteristicNotification(rx, true)
      // THE CCCD WRITE. setCharacteristicNotification only flips a local flag; without this
      // descriptor write the car is never asked to notify and 0213 stays silent, with no error.
      val cccd = rx.getDescriptor(CCCD_UUID)
      if (cccd == null) {
        log("rx has no CCCD 0x2902 — notifications cannot be enabled")
        return
      }
      @Suppress("DEPRECATION")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      } else {
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        g.writeDescriptor(cccd)
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
      if (d.uuid != CCCD_UUID) return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        log("CCCD write FAILED status=$status — 0213 will stay silent")
        return
      }
      log("notifications enabled — link up")
      reportState()
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      if (ch.uuid != RX_UUID) return
      forwardFrame(ch.value ?: return)
    }

    override fun onCharacteristicChanged(
      g: BluetoothGatt,
      ch: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      if (ch.uuid != RX_UUID) return
      forwardFrame(value)
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
      if (ch.uuid != TX_UUID) return
      if (status != BluetoothGatt.GATT_SUCCESS) log("write chunk FAILED status=$status")
      writeInFlight = false
      pumpWrites()
    }
  }

  private fun forwardFrame(bytes: ByteArray) {
    // Pipe mode: forward EVERY raw notification to TS, which owns the reassembler and the
    // correlator. Native must not reassemble — two reassemblers would fight over one stream.
    if (foregroundActive) {
      onFrame?.invoke(bytes)
    } else {
      // Phase 4 (background self-signing) reassembles and answers here with no JS.
      log("frame while background: ${bytes.size}B (autonomous mode is Phase 4)")
    }
  }

  // ── writing ────────────────────────────────────────────────────────────────

  /**
   * Raw write to 0212. `bytes` are ALREADY framed (2-byte BE length prefix) by TS bleFraming —
   * native adds nothing, just splits to the negotiated write size.
   *
   * Chunks are QUEUED rather than written in a loop: Android allows one outstanding GATT
   * operation per connection and silently drops a write issued while another is in flight, which
   * would corrupt a multi-chunk frame in a way TS's reassembler could only see as a timeout.
   */
  fun writeRaw(bytes: ByteArray): Boolean {
    val g = gatt
    if (g == null || txChar == null) {
      log("writeRaw: no connected tx")
      return false
    }
    var off = 0
    while (off < bytes.size) {
      val end = minOf(off + blockLength, bytes.size)
      writeQueue.add(bytes.copyOfRange(off, end))
      off = end
    }
    pumpWrites()
    return true
  }

  @SuppressLint("MissingPermission")
  private fun pumpWrites() {
    if (writeInFlight) return
    val g = gatt ?: return
    val tx = txChar ?: return
    val chunk = writeQueue.poll() ?: return
    writeInFlight = true
    val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeCharacteristic(tx, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
        BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run {
        tx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        tx.value = chunk
        g.writeCharacteristic(tx)
      }
    }
    if (!ok) {
      log("writeCharacteristic refused — dropping chunk")
      writeInFlight = false
    }
  }

  // ── state ──────────────────────────────────────────────────────────────────

  /** (state, mtu) for TS to gate its handshake and seed blockLength — mirrors connectionSnapshot(). */
  fun connectionSnapshot(): Pair<String, Int> {
    val ready = gatt != null && txChar != null && rxChar != null
    val state = when {
      ready -> "connected"
      adapter == null -> "unsupported"
      adapter?.isEnabled != true -> "poweredOff"
      else -> "disconnected"
    }
    return state to mtu
  }

  private fun reportState() {
    val (state, m) = connectionSnapshot()
    onConnectionState?.invoke(state, m)
  }
}

/**
 * VIN → advertised local name, ported from `src/ble/bleScanName.ts` (itself from the
 * vehicle-command Go SDK): `"S" + lower_hex(sha1(utf8(VIN))[0:8]) + "C"`, 18 chars. Matched by
 * EXACT string equality against the advertisement's local name.
 */
fun vehicleLocalName(vin: String): String {
  val digest = MessageDigest.getInstance("SHA-1").digest(vin.toByteArray(Charsets.UTF_8))
  val hex = digest.take(8).joinToString("") { "%02x".format(it) }
  return "S${hex}C"
}
