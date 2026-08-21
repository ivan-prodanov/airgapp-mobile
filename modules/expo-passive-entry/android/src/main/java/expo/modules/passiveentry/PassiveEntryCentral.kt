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
    // Idempotent ONLY while we are genuinely scanning or connected. A previous start that
    // aborted on a missing permission or a disabled radio leaves the VIN armed but nothing
    // running, and re-arming after the user grants the permission (or switches Bluetooth on)
    // must not be swallowed as "already running" — that bug made the retry a no-op and looked
    // exactly like the scan silently failing.
    if (isRunning && targetName == name && (scanning || gatt != null)) {
      log("start($name) — already running")
      return
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
    // Filter on the ADVERTISED 16-bit UUID, not the GATT service. Matching the local name too
    // would be redundant here — we check it in the callback, where the name is authoritative.
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ADVERTISED_SERVICE).build())
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    log("scanning for $targetName (adv service 1122)")
    runCatching { scanner.startScan(filters, settings, scanCallback) }
      .onFailure { log("startScan threw: ${it.message}"); scanning = false }
  }

  @SuppressLint("MissingPermission")
  private fun stopScan() {
    if (!scanning) return
    scanning = false
    runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
  }

  private val scanCallback = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val advName = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull()
      val want = targetName ?: return
      if (advName != want) return
      log("discovered $advName rssi=${result.rssi} → connecting")
      stopScan()
      connect(result.device)
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      log("scan FAILED code=$errorCode")
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
