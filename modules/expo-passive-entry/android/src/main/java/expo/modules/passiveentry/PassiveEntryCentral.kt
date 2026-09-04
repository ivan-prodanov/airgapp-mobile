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
import android.os.PowerManager
import android.os.SystemClock

/**
 * The GATT central that holds the link to the car — the BLE half of ios/PassiveEntryCentral.swift,
 * rebuilt around what Android actually provides (spec §1):
 *
 *  - ONE thread. Every field below is touched only on [handler] (the runtime's HandlerThread). GATT
 *    callbacks are delivered there via the connectGatt(…, handler) overload; scan callbacks and the
 *    JS bridge are posted onto it.
 *  - STANDING CONNECT, no scan. Once the car's address is known, connectGatt(autoConnect = true) is
 *    Android's pending connect: no timeout, controller-driven, lands the moment the car is in range
 *    (the official app enables it on API ≥ 34). Discovery scans exist for the first sighting and as a
 *    bounded fallback while the app is visible; background discovery is the runtime's PendingIntent
 *    scan, which feeds onExternalScanResult.
 *  - INDICATIONS. 0213 is subscribed with ENABLE_INDICATION_VALUE when the characteristic offers it —
 *    what the official app and the vehicle-command SDK do; NOTIFY is the fallback.
 *  - Every connectGatt is paired with close(): Android has ~32 GATT client slots per device and a
 *    leaked client is a permanent "connectGatt returns null" until Bluetooth is toggled.
 *  - One write in flight; chunks are queued and pumped from onCharacteristicWrite.
 *
 * Two modes share the code: PERSISTENT (main process — remembers the address, reconnects forever,
 * self-signs whenever the app is not visible) and EPHEMERAL (the :share process — a direct connect
 * for one send, nothing persisted, no responder: the iOS BleBytePipe).
 */
@SuppressLint("MissingPermission") // arm() refuses to run without BLUETOOTH_SCAN/CONNECT (BleGuards)
class PassiveEntryCentral(
  private val context: Context,
  val mode: Mode,
  private val store: PassiveEntryStore,
  private val logger: NativeLog,
  private val handler: Handler,
  private val visible: () -> Boolean,
  private val responderFactory: ((String) -> VcsecResponder)?,
) {
  enum class Mode { PERSISTENT, EPHEMERAL }

  enum class State { IDLE, DISCOVERING, STANDING, CONNECTING, NEGOTIATING, READY }

  class Snapshot(val state: State, val mtu: Int, val armed: Boolean)

  /** Pipe mode: every raw 0213 notification goes to TS (foreground). Autonomous: the responder. */
  var onFrame: ((ByteArray) -> Unit)? = null

  /** Link up/down for the byte pipe: (connected, mtu). */
  var onLinkState: ((Boolean, Int) -> Unit)? = null

  /** Every state transition — the runtime drives the service card and background discovery off it. */
  var onStateChanged: ((State) -> Unit)? = null

  @Volatile var snapshot = Snapshot(State.IDLE, DEFAULT_MTU, false)
    private set

  // Single-writer gate. true = FOREGROUND: native is a dumb byte pipe, TS signs. false = BACKGROUND:
  // native self-signs. PERSISTENT defaults to autonomous (safe when no JS is listening); EPHEMERAL is
  // always a pipe.
  @Volatile private var pipeMode = mode == Mode.EPHEMERAL

  // ── handler-thread state ───────────────────────────────────────────────────
  private var armed = false
  private var vin = ""
  private var state = State.IDLE
  private var gatt: BluetoothGatt? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var rxChar: BluetoothGattCharacteristic? = null
  private var mtu = DEFAULT_MTU
  private var mtuSettled = false
  private var responder: VcsecResponder? = null
  private var scanCallback: ScanCallback? = null
  private val windowAdvertisers = HashSet<String>()
  private var windowOtherTesla: String? = null
  private var windowWeakSighting: String? = null
  private val windowSightings = HashSet<String>()
  /** Addresses that have identified as the car at any point — an unfiltered diagnostic window logs every event from them. */
  private val carAddresses = HashSet<String>()
  private var windowUnfiltered = false
  private var windowHadConnectableCar = false
  private var lastUnfilteredWindowAt = 0L
  private val scanStarts = ArrayDeque<Long>()
  private var standingSince = 0L
  private var consecutiveErrors = 0
  private var cccdAttempts = 0
  private var loggedNoPermission = false
  private val writeQueue = ArrayDeque<ByteArray>()
  private var writeInFlight = false
  private var bringupLock: PowerManager.WakeLock? = null

  private val adapter: BluetoothAdapter?
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private val blockLength: Int get() = (mtu - 3).coerceAtLeast(20)

  private fun log(line: String) = logger.log(line)

  // Timers: one Runnable each so they can be cancelled individually.
  private val scanWindowEnd = Runnable { endDiscoveryWindow() }
  private val scanRestart = Runnable { if (armed && state == State.DISCOVERING && visible()) beginDiscovery("window restart") }
  private val connectTimeout = Runnable { onConnectTimeout() }
  private val mtuTimeout = Runnable {
    if (state == State.NEGOTIATING && !mtuSettled) {
      log("MTU: no onMtuChanged within ${MTU_TIMEOUT_MS}ms — continuing at $mtu")
      onMtuSettled()
    }
  }
  private val discoveryTimeout = Runnable { if (state == State.NEGOTIATING) failBringup("service discovery timed out") }
  private val standingFallback = Runnable {
    if (armed && state == State.STANDING && visible()) beginDiscovery("standing connect has not landed")
  }
  private val reconnect = Runnable { reestablish("reconnect") }

  // ── public surface (any thread) ────────────────────────────────────────────

  fun arm(vin: String) = post { armLocked(vin) }

  fun disarm() = post { disarmLocked() }

  fun setPipeMode(active: Boolean) = post {
    if (pipeMode == active) return@post
    pipeMode = active
    log("foregroundResponderActive=$active")
    // Flipping to autonomous while connected: native needs its OWN session (TS's isn't shared).
    if (!active && state == State.READY) responder?.onLinkReady()
  }

  fun onVisibilityChanged(isVisible: Boolean) = post {
    if (!armed) return@post
    if (isVisible) {
      if (state == State.DISCOVERING && scanCallback == null) beginDiscovery("app visible")
      if (state == State.STANDING) {
        handler.removeCallbacks(standingFallback)
        handler.postDelayed(standingFallback, STANDING_FALLBACK_MS)
      }
    } else if (mode == Mode.PERSISTENT && state == State.DISCOVERING && scanCallback != null) {
      stopScan()
      log("app hidden — callback scan stopped; background discovery takes over")
    }
  }

  fun onBluetoothOff() = post {
    log("Bluetooth OFF — dropping the link")
    val wasReady = state == State.READY
    stopScan()
    handler.removeCallbacks(reconnect)
    teardownGatt(closeOnly = state == State.STANDING)
    responder?.onLinkLost()
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
  }

  fun onBluetoothOn() = post { if (armed) reestablish("bluetooth on") }

  /** Periodic watchdog (4 h): a standing connect that never landed gets recreated (official app's REINITIALIZE_CONNECTION). */
  fun reinit(reason: String) = post {
    if (state != State.STANDING) return@post
    log("reinit ($reason): recreating the standing connect")
    teardownGatt(closeOnly = true)
    setState(State.IDLE)
    reestablish(reason)
  }

  /** A result from the runtime's PendingIntent scan (background discovery). */
  fun onExternalScanResult(result: ScanResult) = post { if (armed) handleScanResult(result, external = true) }

  /** Raw write to 0212 for the TS byte pipe: already framed by TS, split here to the negotiated size. */
  fun writeRaw(bytes: ByteArray): Boolean {
    if (snapshot.state != State.READY) {
      log("writeRaw: no connected tx")
      return false
    }
    post { enqueue(bytes) }
    return true
  }

  /** For the autonomous responder: add the 2-byte big-endian length prefix, then queue. */
  fun writeFramed(payload: ByteArray) {
    val framed = byteArrayOf(((payload.size shr 8) and 0xff).toByte(), (payload.size and 0xff).toByte()) + payload
    post { enqueue(framed) }
  }

  /** (state, mtu) for TS — mirrors connectionSnapshot() in the Swift. */
  fun connectionSnapshot(): Pair<String, Int> {
    val s = snapshot
    val ad = adapter
    val name = when {
      s.state == State.READY -> "connected"
      ad == null -> "unsupported"
      !ad.isEnabled -> "poweredOff"
      !BleGuards.hasScanPermissions(context) -> "unauthorized"
      else -> "disconnected"
    }
    return name to s.mtu
  }

  /** The filters the runtime's PendingIntent scan uses — identical to the foreground ones. */
  fun backgroundScanFilters(): List<ScanFilter> = buildFilters(store.vin ?: vin)

  /**
   * Scan settings that report EXTENDED (Bluetooth 5) advertisements as well as legacy ones.
   * Measured in the car 2026-09-04: the only legacy event the car sends is a scannable,
   * NON-connectable iBeacon (name in its scan response) — the connectable advertisement is an
   * extended one, which a default legacy-only scan never reports while iOS and macOS see both.
   */
  fun scanSettings(scanMode: Int): ScanSettings {
    val b = ScanSettings.Builder().setScanMode(scanMode)
    if (adapter?.isLeExtendedAdvertisingSupported == true) b.setLegacy(false).setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
    return b.build()
  }

  // ── arm / disarm / reestablish ─────────────────────────────────────────────

  private fun armLocked(vin: String) {
    if (armed && this.vin == vin) {
      if (state == State.IDLE) reestablish("re-arm") // IDLE while armed = Bluetooth was off, or an ephemeral miss
      return
    }
    if (armed) disarmLocked()
    this.vin = vin
    armed = true
    consecutiveErrors = 0
    responder = responderFactory?.invoke(vin)
    log("arm vin=…${vin.takeLast(6)} name=${VehicleIdentity.localName(vin)} mode=$mode")
    reestablish("arm")
  }

  private fun disarmLocked() {
    if (!armed) return
    armed = false
    log("stop")
    stopScan()
    handler.removeCallbacks(reconnect)
    val wasReady = state == State.READY
    teardownGatt(closeOnly = state == State.STANDING)
    responder = null
    vin = ""
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
  }

  /**
   * Get the link back UP. A remembered address means a STANDING connect (no scan) — measured on iOS
   * 2026-07-25, re-scanning after every disconnect left the link down 72% of the time. Scanning is
   * for the first sighting only, and only while the app is visible; in the background the runtime's
   * PendingIntent scan does the looking.
   */
  private fun reestablish(reason: String) {
    if (!armed) return
    if (state == State.CONNECTING || state == State.NEGOTIATING || state == State.READY) return
    handler.removeCallbacks(reconnect)
    val ad = adapter
    if (ad == null) {
      setState(State.IDLE)
      return
    }
    if (!ad.isEnabled) {
      if (state != State.IDLE) log("reestablish($reason): Bluetooth is off — waiting")
      setState(State.IDLE)
      return
    }
    if (!BleGuards.hasScanPermissions(context)) {
      if (!loggedNoPermission) {
        loggedNoPermission = true
        log("MISSING BLE runtime permissions — a scan would return zero results silently; waiting for the grant")
      }
      setState(State.IDLE)
      return
    }
    loggedNoPermission = false
    val mac = store.rememberedMac(vin)
    if (mode == Mode.EPHEMERAL) {
      // One send: dial the remembered address right away AND look for the car for 3 s, first wins.
      if (mac != null) directConnect(ad.getRemoteDevice(mac), "remembered address")
      beginDiscovery("ephemeral")
      return
    }
    if (mac != null) {
      standingConnect(ad.getRemoteDevice(mac))
      return
    }
    if (visible()) {
      beginDiscovery(reason)
    } else if (state != State.DISCOVERING) {
      log("no remembered address and app not visible — background discovery only")
      setState(State.DISCOVERING)
    }
  }

  // ── discovery scans (bounded) ──────────────────────────────────────────────

  private fun buildFilters(forVin: String): List<ScanFilter> {
    val filters = mutableListOf(
      // The car's PRIMARY packet: an Apple iBeacon with Tesla's fixed UUID. The one identifier Android
      // receives reliably (the name and 1122 ride in the scan response).
      ScanFilter.Builder()
        .setManufacturerData(VehicleIdentity.APPLE_COMPANY_ID, VehicleIdentity.BEACON_FILTER_DATA, VehicleIdentity.BEACON_FILTER_MASK)
        .build(),
      ScanFilter.Builder().setServiceUuid(ParcelUuid(VehicleIdentity.ADVERTISED_SERVICE)).build(),
      ScanFilter.Builder().setDeviceName(VehicleIdentity.localName(forVin)).build(),
    )
    // The official app's fourth identity: a 128-bit UUID from VIN bytes 1..16, carried in the
    // connectable advertisement's own payload (the beacon event above is not connectable).
    VehicleIdentity.perVinServiceUuid(forVin)?.let { filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid(it)).build()) }
    store.rememberedMac(forVin)?.let { mac ->
      runCatching { ScanFilter.Builder().setDeviceAddress(mac).build() }.getOrNull()?.let(filters::add)
    }
    return filters
  }

  private fun beginDiscovery(reason: String, unfiltered: Boolean = false) {
    if (!armed) return
    if (scanCallback != null) return
    val ad = adapter ?: return
    val scanner = ad.bluetoothLeScanner ?: run { log("no BLE scanner"); return }
    // Android blocks an app that starts more than 5 scans in 30 s (SCAN_FAILED_SCANNING_TOO_FREQUENTLY).
    val now = SystemClock.elapsedRealtime()
    while (scanStarts.isNotEmpty() && now - scanStarts.first() > 30_000L) scanStarts.removeFirst()
    if (scanStarts.size >= 4) {
      val wait = 30_000L - (now - scanStarts.first()) + 500L
      log("scan rate limit — next window in ${wait}ms")
      handler.removeCallbacks(scanRestart)
      handler.postDelayed(scanRestart, wait)
      if (state == State.IDLE) setState(State.DISCOVERING)
      return
    }
    scanStarts.addLast(now)
    val lowLatency = visible() || mode == Mode.EPHEMERAL
    val settings = scanSettings(if (lowLatency) ScanSettings.SCAN_MODE_LOW_LATENCY else ScanSettings.SCAN_MODE_LOW_POWER)
    val filters = if (unfiltered) emptyList() else buildFilters(vin)
    windowUnfiltered = unfiltered
    windowHadConnectableCar = false
    if (unfiltered) lastUnfilteredWindowAt = SystemClock.elapsedRealtime()
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        post { if (scanCallback === this) handleScanResult(result, external = false) }
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        post { if (scanCallback === this) results.forEach { handleScanResult(it, external = false) } }
      }

      override fun onScanFailed(errorCode: Int) {
        post { if (scanCallback === this) onScanFailed(errorCode) }
      }
    }
    windowAdvertisers.clear()
    windowOtherTesla = null
    windowWeakSighting = null
    windowSightings.clear()
    try {
      scanner.startScan(filters, settings, cb)
    } catch (e: Exception) {
      log("startScan threw: ${e.message}")
      return
    }
    scanCallback = cb
    val windowMs = when {
      mode == Mode.EPHEMERAL && store.rememberedMac(vin) != null -> 3_000L
      mode == Mode.EPHEMERAL -> 10_000L
      else -> SCAN_WINDOW_MS
    }
    val what = if (unfiltered) "UNFILTERED (diagnostic: logging every event from the car's address)" else "beacon|1122|name|vinUuid${if (filters.size == 5) "|address" else ""}"
    log("scanning ($reason): $what, ${windowMs}ms window, ${if (lowLatency) "low-latency" else "low-power"}, legacyOnly=${settings.legacy}")
    handler.removeCallbacks(scanWindowEnd)
    handler.postDelayed(scanWindowEnd, windowMs)
    if (state == State.IDLE) setState(State.DISCOVERING)
  }

  private fun stopScan() {
    scanCallback?.let { cb -> runCatching { adapter?.bluetoothLeScanner?.stopScan(cb) } }
    scanCallback = null
    handler.removeCallbacks(scanWindowEnd)
    handler.removeCallbacks(scanRestart)
  }

  private fun endDiscoveryWindow() {
    if (scanCallback == null) return
    stopScan()
    val extra = buildString {
      windowOtherTesla?.let { append(" (another Tesla's beacon: $it)") }
      windowWeakSighting?.let { append(" (car heard but too weak: $it)") }
    }
    log("scan window ended — ${windowAdvertisers.size} advertiser(s), no car$extra")
    if (!armed) return
    // Heard the car but only on non-connectable events: look once, wide open, so the log shows
    // exactly what else the car sends (bounded to one unfiltered window per 5 minutes).
    val heardButUnreachable = windowSightings.isNotEmpty() && !windowHadConnectableCar
    val diagnoseNext = heardButUnreachable && !windowUnfiltered && visible() &&
      SystemClock.elapsedRealtime() - lastUnfilteredWindowAt > UNFILTERED_WINDOW_INTERVAL_MS
    when (mode) {
      Mode.EPHEMERAL -> if (state == State.DISCOVERING) {
        setState(State.IDLE)
        log("ephemeral: car not found")
      }
      Mode.PERSISTENT -> if (state == State.DISCOVERING && visible()) {
        if (diagnoseNext) handler.postDelayed({ if (armed && state == State.DISCOVERING && visible()) beginDiscovery("car heard but not connectable", unfiltered = true) }, SCAN_PAUSE_MS)
        else handler.postDelayed(scanRestart, SCAN_PAUSE_MS)
      }
    }
  }

  private fun onScanFailed(code: Int) {
    scanCallback = null
    handler.removeCallbacks(scanWindowEnd)
    val why = when (code) {
      1 -> "ALREADY_STARTED"
      2 -> "APPLICATION_REGISTRATION_FAILED"
      3 -> "INTERNAL_ERROR"
      4 -> "FEATURE_UNSUPPORTED"
      5 -> "OUT_OF_HARDWARE_RESOURCES"
      6 -> "SCANNING_TOO_FREQUENTLY"
      else -> "unknown"
    }
    log("scan FAILED code=$code ($why)")
    if (armed && state == State.DISCOVERING && visible()) handler.postDelayed(scanRestart, 30_000L)
  }

  private fun handleScanResult(result: ScanResult, external: Boolean) {
    if (!armed) return
    val record = result.scanRecord
    val addr = result.device.address
    val apple = record?.getManufacturerSpecificData(VehicleIdentity.APPLE_COMPANY_ID)
    val uuids = record?.serviceUuids?.map { it.uuid } ?: emptyList()
    val name = record?.deviceName
    val match = VehicleIdentity.classify(apple, uuids, name, vin)
    if (windowUnfiltered && (addr in carAddresses || match != VehicleIdentity.Match.NONE)) {
      val svc = uuids.joinToString(",") { it.toString() }.ifEmpty { "-" }
      val key = "raw/$addr/${result.isConnectable}/$svc/${name ?: "-"}/${apple != null}"
      if (windowSightings.add(key)) {
        log("car event: $addr connectable=${result.isConnectable} legacy=${result.isLegacy} phy=${result.primaryPhy}/${result.secondaryPhy} rssi=${result.rssi} svc=[$svc] name=${name ?: "-"} appleMfg=${apple?.size ?: 0}B match=$match")
      }
    }
    if (match == VehicleIdentity.Match.NONE) {
      windowAdvertisers.add(addr)
      if (windowOtherTesla == null) {
        VehicleIdentity.teslaBeacon(apple)?.let { b ->
          windowOtherTesla = "minor=${b.minor} want=${VehicleIdentity.expectedBeaconMinor(vin)} rssi=${result.rssi}"
        }
      }
      return
    }
    // One line per (address, match, connectable) per window: enough to see which advertising event
    // the car is actually reachable on.
    val connectable = result.isConnectable
    carAddresses.add(addr)
    if (connectable) windowHadConnectableCar = true
    if (windowSightings.add("$addr/$match/$connectable")) {
      log("car sighting: $match at $addr connectable=$connectable legacy=${result.isLegacy} phy=${result.primaryPhy}/${result.secondaryPhy} rssi=${result.rssi}${if (name != null) " name=$name" else ""}")
    }
    // A non-connectable event (the iBeacon frame is one) cannot be dialled — the connectable
    // advertisement follows on its own event; the official app checks isConnectable the same way.
    if (!connectable) return
    // Official-app rule for a BACKGROUND sighting: do not dial a car at the edge of range.
    if (!visible() && result.rssi <= BACKGROUND_RSSI_GATE) {
      if (windowWeakSighting == null) windowWeakSighting = "$match rssi=${result.rssi}"
      return
    }
    sighted(result.device, result.rssi, match, external)
  }

  private fun sighted(device: BluetoothDevice, rssi: Int, match: VehicleIdentity.Match, external: Boolean) {
    val addr = device.address
    when (state) {
      State.NEGOTIATING, State.READY -> return
      State.CONNECTING -> {
        if (gatt?.device?.address == addr) return
        log("car sighted at $addr while connecting to ${gatt?.device?.address} — switching")
        teardownGatt(closeOnly = true)
      }
      State.STANDING -> {
        val standingFor = SystemClock.elapsedRealtime() - standingSince
        if (gatt?.device?.address == addr) {
          if (standingFor < STANDING_SIGHTING_GRACE_MS) return
          log("standing connect has not landed after ${standingFor}ms — direct connect instead")
        } else {
          log("car sighted at $addr but the remembered address is ${gatt?.device?.address} — replacing it")
          if (mode == Mode.PERSISTENT) store.rememberMac(vin, null)
        }
        teardownGatt(closeOnly = true)
      }
      State.DISCOVERING, State.IDLE -> {}
    }
    log("$match MATCH — rssi=$rssi $addr${if (external) " (background scan)" else ""} → connecting")
    stopScan()
    directConnect(device, match.name)
  }

  // ── connecting ─────────────────────────────────────────────────────────────

  // Any PHY: the car's connectable advertisement is extended and may sit on 2M or Coded. (The mask
  // is ignored for autoConnect — the controller's allow list handles that path.)
  private val anyPhy = BluetoothDevice.PHY_LE_1M_MASK or BluetoothDevice.PHY_LE_2M_MASK or BluetoothDevice.PHY_LE_CODED_MASK

  private fun connectGatt(device: BluetoothDevice, autoConnect: Boolean): BluetoothGatt? =
    device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE, anyPhy, handler)

  /** We have just SEEN the car: a direct connect is immediate. */
  private fun directConnect(device: BluetoothDevice, why: String) {
    teardownGatt(closeOnly = state == State.STANDING)
    setState(State.CONNECTING)
    log("connecting ${device.address} ($why)")
    val g = connectGatt(device, autoConnect = false)
    if (g == null) {
      log("connectGatt returned null — no GATT client slot; retrying later")
      consecutiveErrors += 1
      setState(State.IDLE)
      scheduleReconnect(DELAY_AFTER_ERROR)
      return
    }
    gatt = g
    handler.removeCallbacks(connectTimeout)
    handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
  }

  /** The car may not be in range: autoConnect = true is Android's pending connect (no timeout, controller-driven). */
  private fun standingConnect(device: BluetoothDevice) {
    teardownGatt(closeOnly = true)
    setState(State.STANDING)
    standingSince = SystemClock.elapsedRealtime()
    val g = connectGatt(device, autoConnect = true)
    if (g == null) {
      log("standing connectGatt returned null — retrying later")
      setState(State.IDLE)
      scheduleReconnect(DELAY_AFTER_ERROR)
      return
    }
    gatt = g
    log("pending connect (standing, no scan) → ${device.address}")
    handler.removeCallbacks(standingFallback)
    if (visible()) handler.postDelayed(standingFallback, STANDING_FALLBACK_MS)
  }

  private fun onConnectTimeout() {
    if (state != State.CONNECTING) return
    log("connect timed out after ${CONNECT_TIMEOUT_MS}ms")
    consecutiveErrors += 1
    teardownGatt(closeOnly = true)
    setState(State.IDLE)
    if (mode == Mode.EPHEMERAL) return
    scheduleReconnect(DELAY_AFTER_ERROR)
  }

  private fun scheduleReconnect(delayMs: Long) {
    if (!armed || mode == Mode.EPHEMERAL) return
    handler.removeCallbacks(reconnect)
    // Hold the CPU through the delay (official app: tesla:ble-peripheral-reconnect, delay + 1 s).
    runCatching {
      (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
        ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:ble-reconnect")
        ?.acquire(delayMs + 1_000L)
    }
    handler.postDelayed(reconnect, delayMs)
  }

  private fun delayFor(status: Int): Long = when (status) {
    0, 8, 34 -> DELAY_AFTER_NORMAL_DISCONNECT
    else -> DELAY_AFTER_ERROR
  }

  private fun statusName(status: Int): String = when (status) {
    0 -> "success"
    8 -> "connection timeout"
    19 -> "remote terminated"
    22 -> "local host terminated"
    34 -> "LMP response timeout"
    62 -> "failed to establish"
    133 -> "GATT_ERROR"
    else -> "0x%02x".format(status)
  }

  // ── GATT callbacks (delivered on the handler thread) ───────────────────────

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = post {
      if (g !== gatt) { runCatching { g.close() }; return@post }
      when {
        newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS -> onConnected()
        newState == BluetoothProfile.STATE_DISCONNECTED -> onDisconnected(status)
        newState == BluetoothProfile.STATE_CONNECTED -> onDisconnected(status) // connected-with-error: treat as a drop
        else -> log("connection state=$newState status=$status")
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) = post {
      if (g !== gatt) return@post
      if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu
      log("MTU=$mtu (blockLength=$blockLength)${if (status != 0) " status=$status" else ""}")
      if (state == State.NEGOTIATING && !mtuSettled) onMtuSettled()
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = post {
      if (g !== gatt || state != State.NEGOTIATING) return@post
      handler.removeCallbacks(discoveryTimeout)
      if (status != BluetoothGatt.GATT_SUCCESS) { failBringup("service discovery status=$status"); return@post }
      val svc = g.getService(VehicleIdentity.VCSEC_SERVICE)
      if (svc == null) {
        if (mode == Mode.PERSISTENT) store.rememberMac(vin, null)
        failBringup("no VCSEC service on ${g.device.address} — not the car; address forgotten")
        return@post
      }
      txChar = svc.getCharacteristic(VehicleIdentity.TX_CHAR)
      rxChar = svc.getCharacteristic(VehicleIdentity.RX_CHAR)
      if (txChar == null || rxChar == null) { failBringup("missing tx/rx characteristic"); return@post }
      cccdAttempts = 0
      subscribe()
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) = post {
      if (g !== gatt || d.uuid != VehicleIdentity.CCCD || state != State.NEGOTIATING) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) {
        cccdAttempts += 1
        if (cccdAttempts < 3) {
          log("CCCD write status=$status — retrying (${cccdAttempts}/3)")
          handler.postDelayed({ if (state == State.NEGOTIATING) subscribe() }, 1_000L)
        } else {
          failBringup("CCCD write failed status=$status")
        }
        return@post
      }
      becomeReady()
    }

    @Deprecated("pre-33 callback")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return // the 3-arg overload is delivered instead
      @Suppress("DEPRECATION") val value = ch.value ?: return
      post { if (g === gatt && ch.uuid == VehicleIdentity.RX_CHAR) deliver(value) }
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
      post { if (g === gatt && ch.uuid == VehicleIdentity.RX_CHAR) deliver(value) }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) = post {
      if (g !== gatt || ch.uuid != VehicleIdentity.TX_CHAR) return@post
      writeInFlight = false
      if (status != BluetoothGatt.GATT_SUCCESS) {
        log("write chunk FAILED status=$status — dropping ${writeQueue.size} queued chunk(s)")
        writeQueue.clear()
        return@post
      }
      pump()
    }
  }

  private fun onConnected() {
    val g = gatt ?: return
    handler.removeCallbacks(connectTimeout)
    handler.removeCallbacks(standingFallback)
    stopScan()
    log("CONNECTED ${g.device.address} — requesting MTU $REQUESTED_MTU")
    // Remember it so every future re-establish is a standing connect (iOS stores the peripheral UUID here).
    if (mode == Mode.PERSISTENT) store.rememberMac(vin, g.device.address)
    acquireBringupLock()
    mtuSettled = false
    setState(State.NEGOTIATING)
    if (!g.requestMtu(REQUESTED_MTU)) {
      log("requestMtu refused — continuing at $mtu")
      onMtuSettled()
    } else {
      handler.removeCallbacks(mtuTimeout)
      handler.postDelayed(mtuTimeout, MTU_TIMEOUT_MS)
    }
  }

  private fun onMtuSettled() {
    mtuSettled = true
    handler.removeCallbacks(mtuTimeout)
    val g = gatt ?: return
    if (g.discoverServices()) {
      handler.removeCallbacks(discoveryTimeout)
      handler.postDelayed(discoveryTimeout, DISCOVERY_TIMEOUT_MS)
    } else {
      failBringup("discoverServices refused")
    }
  }

  /** INDICATE when the characteristic offers it (official app + vehicle-command), else NOTIFY. */
  private fun subscribe() {
    val g = gatt ?: return
    val rx = rxChar ?: return
    val useIndicate = rx.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
    val cccd = rx.getDescriptor(VehicleIdentity.CCCD)
    if (cccd == null) { failBringup("rx has no CCCD 0x2902"); return }
    log("chars ok — subscribing (${if (useIndicate) "indicate" else "notify"}, props=0x%02x)".format(rx.properties))
    g.setCharacteristicNotification(rx, true)
    val value = if (useIndicate) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    val ok = if (Build.VERSION.SDK_INT >= 33) {
      g.writeDescriptor(cccd, value) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run { cccd.value = value; g.writeDescriptor(cccd) }
    }
    if (!ok) {
      cccdAttempts += 1
      if (cccdAttempts < 3) handler.postDelayed({ if (state == State.NEGOTIATING) subscribe() }, 1_000L)
      else failBringup("writeDescriptor refused")
    }
  }

  private fun becomeReady() {
    releaseBringupLock()
    consecutiveErrors = 0
    setState(State.READY)
    log("notifications enabled — link up (mtu=$mtu, ${if (pipeMode) "pipe" else "autonomous"})")
    onLinkState?.invoke(true, mtu)
    if (!pipeMode) responder?.onLinkReady()
  }

  private fun failBringup(why: String) {
    log("bring-up FAILED: $why")
    consecutiveErrors += 1
    teardownGatt(closeOnly = false)
    setState(State.IDLE)
    if (mode == Mode.EPHEMERAL) return
    scheduleReconnect(DELAY_AFTER_ERROR)
  }

  private fun onDisconnected(status: Int) {
    val wasReady = state == State.READY
    log("DISCONNECTED status=$status (${statusName(status)})")
    if (status != 0 && status != 8 && status != 34) consecutiveErrors += 1
    teardownGatt(closeOnly = false)
    responder?.onLinkLost()
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
    if (!armed || mode == Mode.EPHEMERAL) return
    val delay = if (consecutiveErrors >= 5) {
      log("5 consecutive GATT errors — Bluetooth may need a toggle; pausing ${ERROR_STORM_PAUSE_MS}ms")
      consecutiveErrors = 0
      ERROR_STORM_PAUSE_MS
    } else {
      delayFor(status)
    }
    log("→ reconnect in ${delay}ms")
    scheduleReconnect(delay)
  }

  /** Close the GATT client (always) and reset link state. [closeOnly] skips disconnect() for a never-connected client. */
  private fun teardownGatt(closeOnly: Boolean) {
    handler.removeCallbacks(connectTimeout)
    handler.removeCallbacks(mtuTimeout)
    handler.removeCallbacks(discoveryTimeout)
    handler.removeCallbacks(standingFallback)
    val g = gatt
    gatt = null
    txChar = null
    rxChar = null
    writeQueue.clear()
    writeInFlight = false
    mtu = DEFAULT_MTU
    mtuSettled = false
    if (g != null) {
      if (!closeOnly) runCatching { g.disconnect() }
      runCatching { g.close() }
    }
    releaseBringupLock()
  }

  // ── writes: one GATT operation in flight ───────────────────────────────────

  private fun enqueue(bytes: ByteArray) {
    if (state != State.READY) {
      log("write dropped — link not ready (${bytes.size}B)")
      return
    }
    var off = 0
    while (off < bytes.size) {
      val end = minOf(off + blockLength, bytes.size)
      writeQueue.addLast(bytes.copyOfRange(off, end))
      off = end
    }
    pump()
  }

  private fun pump() {
    if (writeInFlight) return
    val g = gatt ?: return
    val tx = txChar ?: return
    val chunk = writeQueue.removeFirstOrNull() ?: return
    writeInFlight = true
    val ok = if (Build.VERSION.SDK_INT >= 33) {
      g.writeCharacteristic(tx, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run {
        tx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        tx.value = chunk
        g.writeCharacteristic(tx)
      }
    }
    if (!ok) {
      log("writeCharacteristic refused — dropping ${writeQueue.size + 1} chunk(s)")
      writeInFlight = false
      writeQueue.clear()
    }
  }

  private fun deliver(bytes: ByteArray) {
    if (pipeMode) onFrame?.invoke(bytes) else responder?.onNotification(bytes)
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private fun setState(s: State) {
    val changed = s != state
    state = s
    snapshot = Snapshot(s, mtu, armed)
    if (changed) onStateChanged?.invoke(s)
  }

  private fun acquireBringupLock() {
    releaseBringupLock()
    bringupLock = runCatching {
      (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
        ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:ble-bringup")
        ?.also { it.acquire(BRINGUP_LOCK_MS) }
    }.getOrNull()
  }

  private fun releaseBringupLock() {
    bringupLock?.let { if (it.isHeld) runCatching { it.release() } }
    bringupLock = null
  }

  private inline fun post(crossinline block: () -> Unit) {
    if (Looper.myLooper() === handler.looper) block() else handler.post { block() }
  }

  private companion object {
    const val DEFAULT_MTU = 23
    const val REQUESTED_MTU = 517
    const val SCAN_WINDOW_MS = 20_000L
    const val SCAN_PAUSE_MS = 5_000L
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val MTU_TIMEOUT_MS = 5_000L
    const val DISCOVERY_TIMEOUT_MS = 10_000L
    const val STANDING_FALLBACK_MS = 30_000L
    const val STANDING_SIGHTING_GRACE_MS = 10_000L
    const val BACKGROUND_RSSI_GATE = -95
    const val DELAY_AFTER_NORMAL_DISCONNECT = 500L
    const val DELAY_AFTER_ERROR = 2_000L
    const val ERROR_STORM_PAUSE_MS = 15_000L
    const val BRINGUP_LOCK_MS = 15_000L
    const val UNFILTERED_WINDOW_INTERVAL_MS = 5L * 60 * 1000
  }
}
