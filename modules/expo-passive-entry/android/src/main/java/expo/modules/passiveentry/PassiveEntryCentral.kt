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

    /** Apple's Bluetooth company identifier — the manufacturer-data key an iBeacon lives under. */
    private const val APPLE_COMPANY_ID = 0x004C

    /**
     * THE identifier that actually works on Android. The car's PRIMARY advertising packet is an
     * Apple iBeacon; its local name (S<hex>C) and service 1122 ride in the SCAN RESPONSE. Android
     * does not reliably deliver that scan response — so the name and 1122 never arrive, and matching
     * on them (as iOS/bluez do, because THEY get the scan response) can never work here. The primary
     * packet, though, Android delivers reliably. So match the car by its iBeacon.
     *
     * Captured byte-exact from this car on 2026-09-03 via the laptop's CoreBluetooth (the same
     * go-ble stack teslamotors/vehicle-command uses), primary-PDU manufacturer data:
     *   4c00 0215 74278bdab64445208f0c720eaf059935 0000 f3ab c5
     *   └ Apple  └iBeacon  └ UUID 74278BDA-…-059935          └major 0 └minor 0xF3AB=62379 └tx
     * The UUID is Tesla's fixed phone-key beacon UUID (also what iOS's CarRegionMonitor ranges); the
     * minor is VIN-derived (see expectedBeaconMinor) and distinguishes THIS car from other Teslas.
     */
    private val BEACON_UUID_BYTES = byteArrayOf(
      0x74, 0x27, 0x8B.toByte(), 0xDA.toByte(), 0xB6.toByte(), 0x44, 0x45, 0x20,
      0x8F.toByte(), 0x0C, 0x72, 0x0E, 0xAF.toByte(), 0x05, 0x99.toByte(), 0x35,
    )

    /** ScanFilter payload "an iBeacon carrying our UUID": iBeacon type(02) len(15) + the 16 UUID bytes. */
    private val BEACON_FILTER_DATA = byteArrayOf(0x02, 0x15) + BEACON_UUID_BYTES
    private val BEACON_FILTER_MASK = ByteArray(BEACON_FILTER_DATA.size) { 0xFF.toByte() }

    /** Tesla's VIN-derived discovery token, `S<16 hex>C` — see src/ble/bleScanName.ts. */
    private val DERIVED_NAME = Regex("^S[0-9A-Fa-f]{16}C$")

    /** `0000abcd-0000-1000-8000-00805f9b34fb` -> `abcd`; anything else is left alone. */
    fun shortUuid(u: String): String =
      if (u.startsWith("0000") && u.endsWith("-0000-1000-8000-00805f9b34fb")) u.substring(4, 8) else u

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

    /** One window in three runs unfiltered, so a failure stays diagnosable. See beginScan. */
    private const val DIAGNOSTIC_WINDOW_EVERY = 3L

    /** How long one candidate gets to connect and answer "do you have VCSEC?" before we move on. */
    private const val PROBE_TIMEOUT_MS = 5_000L

    /** Upper bound on candidates tried in a single pass, so a busy room cannot stall us forever. */
    private const val MAX_PROBES_PER_PASS = 12

    /** Cap on the remembered "definitely not the car" set — addresses rotate, so it must not grow. */
    private const val NOT_THE_CAR_CAP = 256

    /**
     * How long to let a standing connect run alone before ALSO scanning. Long enough that a car
     * merely out of range is not treated as a stale MAC, short enough that a genuinely wrong
     * remembered address does not wedge discovery.
     */
    private const val STANDING_CONNECT_FALLBACK_MS = 20_000L
  }

  var onLog: ((String) -> Unit)? = null
  var onFrame: ((ByteArray) -> Unit)? = null
  var onConnectionState: ((String, Int) -> Unit)? = null

  @Volatile var isRunning: Boolean = false
    private set

  private var foregroundActive: Boolean = true
  private var targetName: String? = null
  /** Counts scan windows so every Nth one can run unfiltered for diagnosis. */
  private var windowCount = 0L

  // ── candidate probing ──────────────────────────────────────────────────────
  // MACs seen advertising this window that were NOT the car by name or service.
  private val candidateMacs = LinkedHashSet<String>()
  // MACs we have connected to and confirmed do NOT expose the VCSEC service. Bounded, because
  // privacy-rotating addresses would otherwise grow this without limit.
  private val notTheCar = LinkedHashSet<String>()
  private var probing = false
  private var probeQueue = mutableListOf<String>()
  private var probeGatt: BluetoothGatt? = null
  private var probeMac: String? = null
  private var targetVin: String? = null
  /** True while a standing (autoConnect) GATT connect is outstanding but not yet CONNECTED. */
  private var standingConnect = false
  private var gatt: BluetoothGatt? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var rxChar: BluetoothGattCharacteristic? = null
  private var mtu: Int = DEFAULT_MTU
  private var scanning = false

  private val main = Handler(Looper.getMainLooper())
  /** Distinct advertisers seen in the current scan window, for the end-of-window diagnostic. */
  private val seenThisWindow = linkedSetOf<String>()
  /** DIAGNOSTIC: log the car iBeacon at most once per scan window (removable after at-car verify). */
  private var beaconLoggedThisWindow = false
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
    targetVin = vin
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
    reestablish()
  }

  // ── re-establish: a STANDING CONNECT beats a scan ──────────────────────────

  /**
   * Get the link back up, preferring a remembered peripheral over a scan — a direct port of
   * PassiveEntryCentral.swift's `reestablish()`.
   *
   * iOS measured this on-car (2026-07-25): re-scanning after every disconnect left the link DOWN
   * 72% of the time, with reconnect gaps of 1-8 MINUTES, because scans get throttled and coalesced.
   * Reconnecting to a KNOWN peripheral does not: `connectGatt(autoConnect = true)` is Android's
   * equivalent of CoreBluetooth's pending connect — no timeout, not scan-throttled, and the OS
   * delivers the connection the instant the car is in range. iOS stores the peripheral's UUID for
   * exactly this; the official app does the same (`retrievePeripheralsWithIdentifiers:` in its
   * binary). Android's stable handle is the MAC.
   *
   * Nothing was persisted here at all before, so EVERY reconnect needed a fresh scan — and Android
   * blocks an app that starts 5 scans in 30s, which looks identical to "no car nearby".
   *
   * Scanning remains the first-ever-discovery path, and a fallback: a remembered MAC can go stale
   * (a different car, a factory reset), so if the standing connect has not landed after
   * STANDING_CONNECT_FALLBACK_MS we scan as well. The standing connect stays armed underneath —
   * they are not exclusive, and whichever wins closes the other out.
   */
  @SuppressLint("MissingPermission")
  private fun reestablish() {
    if (!isRunning) return
    if (gatt != null) return // connected, or a standing connect is already pending
    val mac = rememberedMac()
    val device = mac?.let { runCatching { adapter?.getRemoteDevice(it) }.getOrNull() }
    if (device == null) {
      beginScan() // never connected to this car before
      return
    }
    stopScan() // a standing connect supersedes any in-flight scan
    standingConnect = true
    log("pending connect (standing, no scan) → $mac")
    gatt = device.connectGatt(context, true, gattCallback, BluetoothDevice.TRANSPORT_LE)
    main.postDelayed(standingConnectFallback, STANDING_CONNECT_FALLBACK_MS)
  }

  /** The remembered MAC never landed — the car may have changed. Scan too, keeping the connect armed. */
  private val standingConnectFallback = Runnable {
    if (isRunning && standingConnect) {
      log("standing connect has not landed in ${STANDING_CONNECT_FALLBACK_MS}ms — scanning as well")
      beginScan()
    }
  }

  private fun prefs() = context.getSharedPreferences("passive_entry", android.content.Context.MODE_PRIVATE)

  /** Keyed by VIN: a remembered MAC must never be reused for a different car. */
  private fun macKey(): String? = targetVin?.let { "peripheral_mac_" + it }

  private fun rememberedMac(): String? = macKey()?.let { prefs().getString(it, null) }

  private fun rememberMac(mac: String) {
    val k = macKey() ?: return
    if (prefs().getString(k, null) == mac) return
    prefs().edit().putString(k, mac).apply()
    log("remembered peripheral $mac — future re-connects skip the scan")
  }

  @SuppressLint("MissingPermission")
  fun stop() {
    probing = false
    probeQueue.clear()
    closeProbe()
    log("stop")
    isRunning = false
    targetName = null
    standingConnect = false
    main.removeCallbacks(standingConnectFallback)
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
    if (scanning || probing) return
    scanning = true
    // FILTER, exactly like iOS — this is the fix for "the car is never in the scan results".
    //
    // The previous comment here argued a ScanFilter "buys nothing while risking everything" and
    // that matching the VIN-derived local name unfiltered was stricter AND more robust. Measured on
    // device, that is backwards. Sitting in the awake car, windows reported 15-58 advertisers and
    // the car was in NONE of them — no name, no 1122 — while 12 of 15 entries showed NO service
    // UUIDs at all.
    //
    // That is the tell: an unfiltered Android scan hands us the ADVERTISEMENT, and Tesla's 31-byte
    // advertisement cannot carry both the service UUID and an 18-character local name, so one of
    // them lives in the SCAN RESPONSE. `ScanRecord` does not reliably merge that in for an
    // unfiltered scan, so we were matching against half the data.
    //
    // A ScanFilter is matched in the BLUETOOTH CONTROLLER, against the advertisement AND the scan
    // response. That is why the working iOS implementation has always found this car on the first
    // try: `scanForPeripherals(withServices: [advertisedServiceUUID])` then match by name
    // (PassiveEntryCentral.swift:332,376). CoreBluetooth merges before filtering; Android needs to
    // be ASKED to look, and a filter is how you ask.
    //
    // TWO filters, OR'd by Android: the advertised service (captured on-car, advServices=[1122]),
    // and the local name — so the car is found whichever of the two its advertisement carries.
    val filters = listOf(
      // The car's PRIMARY packet — the one Android reliably delivers. This is the filter that
      // actually surfaces the car; the two below only ever match the scan response, which does not
      // reach us here.
      ScanFilter.Builder().setManufacturerData(APPLE_COMPANY_ID, BEACON_FILTER_DATA, BEACON_FILTER_MASK).build(),
      ScanFilter.Builder().setServiceUuid(ADVERTISED_SERVICE).build(),
      ScanFilter.Builder().setDeviceName(targetName).build(),
    )
    // DEFAULT scan settings — active, legacy. This mirrors iOS's scanForPeripherals, which draws no
    // legacy/extended distinction. Tesla VCSEC is a legacy (BLE 4.x) advertiser, so the default
    // legacy-only reporting is correct and safest; an earlier setLegacy(false)+PHY_LE_ALL_SUPPORTED
    // was a guess that risked mis-handling the car's legacy advertisement on this Samsung/Broadcom
    // stack and is removed.
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    // Every DIAGNOSTIC_WINDOW_EVERY'th window runs UNFILTERED. A filtered scan that finds nothing
    // cannot tell "the car is not here" from "the filter is wrong", and that ambiguity is what made
    // this bug take four attempts. The unfiltered sweep costs one window in three and keeps the
    // end-of-window census that named TeslaFSD-8FCBA4 in the first place.
    windowCount += 1
    val diagnostic = windowCount % DIAGNOSTIC_WINDOW_EVERY == 0L
    val useFilters = if (diagnostic) emptyList() else filters
    seenThisWindow.clear()
    beaconLoggedThisWindow = false
    candidateMacs.clear()
    scanStartedAt = android.os.SystemClock.elapsedRealtime()
    log("scanning for $targetName (${if (diagnostic) "unfiltered census" else "filtered: service 1122 OR name"}), ${SCAN_WINDOW_MS}ms window")
    runCatching { scanner.startScan(useFilters, settings, scanCallback) }
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
    // Discovery found nothing AND we have never connected to this car, so there is no remembered
    // address to fall back on. Ask the candidates directly — see startProbePass.
    if (rememberedMac() == null && candidateMacs.isNotEmpty()) startProbePass()
    reportState()
  }

  /**
   * Connect to each unidentified advertiser and ask whether it exposes the VCSEC service.
   *
   * WHY THIS EXISTS. This car stopped emitting a discoverable advertisement. The iPhone's own log
   * proves it: 161 discoveries, every one `discovered S8d2eb01195e4f42bC advServices=[1122]`, and
   * ALL of them dated 22-25 July. Since 2026-08-01 iOS has discovered the car ZERO times — it has
   * made 428 standing connects in a single day instead, straight to a remembered peripheral
   * (`pending connect (standing, no scan) → 🔑 CHUŠKOPEK`). iOS works because it never has to find
   * the car; it has been coasting on a July connection for over a month.
   *
   * Android has never connected once, so it has no remembered address, so it must discover — and
   * there is nothing discoverable to find. That is a deadlock no scan tuning can break, which is
   * why the name matcher, the legacy/extended flag and the ScanFilter all failed to fix it.
   *
   * The car is still advertising something connectable (iOS reconnects to it constantly); it just
   * carries neither the name nor service 1122 any more, so it lands in our census as one of the
   * `(unnamed …)` rows. So we stop asking what it CLAIMS and ask what it HAS: connect, discover
   * services, keep it if VCSEC is there, drop it otherwise. One hit stores the address and Android
   * is in the same standing-connect regime as iOS from then on — this runs once, ever.
   *
   * Turning off the iPhone's Bluetooth did NOT restore discoverable advertising (tested on-car), so
   * this is not contention for the car's advertising slot.
   */
  @SuppressLint("MissingPermission")
  private fun startProbePass() {
    if (probing || gatt != null) return
    probeQueue = candidateMacs.filter { it !in notTheCar }.take(MAX_PROBES_PER_PASS).toMutableList()
    if (probeQueue.isEmpty()) return
    probing = true
    log("no discoverable car — probing ${probeQueue.size} candidate(s) for VCSEC service")
    probeNext()
  }

  @SuppressLint("MissingPermission")
  private fun probeNext() {
    closeProbe()
    if (!isRunning || probeQueue.isEmpty()) {
      if (probing) log("probe pass finished — no candidate exposed VCSEC")
      probing = false
      return
    }
    val mac = probeQueue.removeAt(0)
    probeMac = mac
    val device = runCatching { adapter?.getRemoteDevice(mac) }.getOrNull()
    if (device == null) { probeNext(); return }
    probeGatt = device.connectGatt(context, false, probeCallback, BluetoothDevice.TRANSPORT_LE)
    main.postDelayed(probeTimeout, PROBE_TIMEOUT_MS)
  }

  private val probeTimeout = Runnable {
    if (!probing) return@Runnable
    probeMac?.let { notTheCar.add(it) } // unreachable within the budget: treat as not the car
    trimNotTheCar()
    probeNext()
  }

  @SuppressLint("MissingPermission")
  private fun closeProbe() {
    main.removeCallbacks(probeTimeout)
    probeGatt?.let { runCatching { it.disconnect() }; runCatching { it.close() } }
    probeGatt = null
  }

  private fun trimNotTheCar() {
    while (notTheCar.size > NOT_THE_CAR_CAP) {
      val oldest = notTheCar.first()
      notTheCar.remove(oldest)
    }
  }

  /**
   * A probe connection only ever asks one question: is the VCSEC service here?
   *
   * Deliberately a SEPARATE callback from gattCallback. The real link's callback subscribes,
   * negotiates MTU and pumps frames; running that against a stranger's speaker would be both wrong
   * and hard to unwind. This one discovers services and hangs up.
   */
  private val probeCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (!probing) { runCatching { g.close() }; return }
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        runCatching { g.discoverServices() }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        main.post {
          if (probing && probeGatt === g) {
            probeMac?.let { notTheCar.add(it) }
            trimNotTheCar()
            probeNext()
          }
        }
      }
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      main.post {
        if (!probing || probeGatt !== g) return@post
        val mac = probeMac
        val hasVcsec = runCatching { g.getService(SERVICE_UUID) != null }.getOrDefault(false)
        if (hasVcsec && mac != null) {
          log("PROBE HIT — $mac exposes VCSEC; remembering it as the car")
          probing = false
          probeQueue.clear()
          closeProbe()
          rememberMac(mac)
          // Hand off to the real connect path, which owns MTU, subscription and the frame pump.
          runCatching { adapter?.getRemoteDevice(mac) }.getOrNull()?.let { connect(it) }
        } else {
          mac?.let { notTheCar.add(it) }
          trimNotTheCar()
          probeNext()
        }
      }
    }
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
      val want = targetName ?: return
      val record = result.scanRecord
      val advName = record?.deviceName ?: runCatching { result.device.name }.getOrNull()
      val uuids = record?.serviceUuids.orEmpty()
      val advertisesTesla = uuids.any { it == ADVERTISED_SERVICE }

      // THE iBEACON — the car's primary packet, and the only identifier Android reliably receives.
      val mfg = record?.getManufacturerSpecificData(APPLE_COMPANY_ID)
      if (mfg != null && mfg.size >= 22 && mfg[0] == 0x02.toByte() && mfg[1] == 0x15.toByte() &&
        BEACON_UUID_BYTES.indices.all { mfg[2 + it] == BEACON_UUID_BYTES[it] }
      ) {
        val major = ((mfg[18].toInt() and 0xFF) shl 8) or (mfg[19].toInt() and 0xFF)
        val minor = ((mfg[20].toInt() and 0xFF) shl 8) or (mfg[21].toInt() and 0xFF)
        val expected = expectedBeaconMinor(targetVin ?: "")
        // DIAGNOSTIC (once per window): prove the car's primary PDU reaches Android at all.
        if (!beaconLoggedThisWindow) {
          beaconLoggedThisWindow = true
          log("iBeacon UUID seen — major=$major minor=$minor (want $expected) rssi=${result.rssi} ${result.device.address}")
        }
        if (expected != null && minor == expected) {
          // Positive identity (VIN-derived minor). This device advertises the iBeacon in its primary
          // PDU AND the VCSEC GATT + scan-response name from the same radio, so its address is the
          // one to dial. MAC is remembered on CONNECTED, not here (an RPA that never completes must
          // not become a standing-connect target).
          log("BEACON MATCH — iBeacon major=$major minor=$minor is our car → connecting ${result.device.address} rssi=${result.rssi}")
          stopScan()
          connect(result.device)
          return
        }
      }

      // MATCH ON THE NAME **OR** THE ADVERTISED SERVICE.
      //
      // Name-only matching is what left this unable to find the car at all. On device, every 20s
      // window saw 23-32 advertisers and NONE carried the expected name, while the derivation was
      // verified correct (sha1("XP7YGCELXTB844019")[0:8] -> S8d2eb01195e4f42bC, byte-identical to
      // bleScanName.ts). The name simply is not in what Android hands us: Tesla's advertisement
      // carries flags plus the 16-bit service, and an 18-character local name does not fit beside
      // them in 31 bytes — it lives in the SCAN RESPONSE, which `ScanRecord.getDeviceName()` does
      // not reliably surface.
      //
      // The advertised service is the signal we can actually depend on, and it was captured from
      // this very car (`advServices=[1122]`, 2026-07-22) rather than assumed. It is also what iOS
      // filters on, so this makes the two platforms agree.
      //
      // The name stays authoritative WHEN PRESENT: another Tesla in the car park advertises 1122
      // too, so a name that is a valid S<16 hex>C token for a DIFFERENT vehicle disqualifies the
      // result. A missing name, or a GAP name the OS has cached, does not.
      val nameMatches = advName == want
      val otherTesla = advName != null && advName != want && DERIVED_NAME.matches(advName)
      if (!nameMatches && !(advertisesTesla && !otherTesla)) {
        // Record rather than drop: if the car is advertising under a name we do not expect, the
        // window summary shows it instead of us reporting a bare "nothing found". Service UUIDs go
        // in too — without them a failure cannot tell "the car was not there" from "the car was
        // there but unnamed", which is exactly the ambiguity that hid this bug.
        // Keep the address: if discovery never yields the car, probeCandidates() connects to these
        // one by one and asks each whether it exposes VCSEC. See startProbePass.
        if (result.device.address !in notTheCar) candidateMacs.add(result.device.address)
        // GROUND-TRUTH census. Everything needed to tell, from ONE awake-car window, exactly what
        // the car transmits to Android and why it did not match: the local name (or its absence),
        // whether it is connectable at all, legacy vs extended, its FULL service UUIDs (not the
        // 16-bit shorthand — so a 128-bit VCSEC service would show), and any manufacturer company
        // IDs. If the car is here, its row shows what is missing; if it is absent, the row is gone.
        if (result.device.address !in notTheCar) candidateMacs.add(result.device.address)
        val svc = uuids.joinToString(",") { it.uuid.toString() }.ifEmpty { "-" }
        val mfgIds = (0 until (record?.manufacturerSpecificData?.size() ?: 0)).joinToString(",") {
          "0x%04x".format(record!!.manufacturerSpecificData.keyAt(it))
        }.ifEmpty { "-" }
        val conn = if (result.isConnectable) "conn" else "nonconn"
        val leg = if (result.isLegacy) "legacy" else "ext"
        seenThisWindow.add(
          "${advName ?: "?"}@${result.device.address} rssi=${result.rssi} $conn $leg svc=$svc mfg=$mfgIds",
        )
        return
      }

      log(
        "discovered ${advName ?: "(unnamed)"} rssi=${result.rssi} " +
          "via ${if (nameMatches) "name" else "advertised service 1122"} → connecting",
      )
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
    // A scan can land while a standing connect is still pending (see reestablish's fallback).
    // Drop that one first: two BluetoothGatt clients to the same car is how you get a phantom
    // link that never delivers notifications. close() rather than disconnect() — the standing one
    // was never connected, so there is nothing to tear down and no callback to wait for.
    main.removeCallbacks(standingConnectFallback)
    if (standingConnect) {
      standingConnect = false
      gatt?.let { runCatching { it.close() } }
      gatt = null
    }
    // autoConnect = false here, deliberately: we have just SEEN this device advertising, so a
    // direct connect is immediate. autoConnect is for the remembered-peripheral path, where the
    // car may not be in range yet.
    gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
  }

  private val gattCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        log("CONNECTED — requesting MTU $REQUESTED_MTU")
        standingConnect = false
        main.removeCallbacks(standingConnectFallback)
        stopScan() // we are in; a lingering scan only burns radio
        // Remember it so every future re-establish is a standing connect rather than a throttled
        // scan — see reestablish(). iOS stores the peripheral UUID at exactly this point.
        rememberMac(g.device.address)
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
        standingConnect = false
        main.removeCallbacks(standingConnectFallback)
        // The car drops the link constantly (sleep, range). Re-acquire while armed — via the
        // remembered peripheral when we have one, which is the whole point of reestablish().
        if (isRunning) main.postDelayed({ if (isRunning) reestablish() }, RECONNECT_DELAY_MS)
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
/**
 * The iBeacon minor this VIN advertises, mirroring iOS's CarRegionMonitor.expectedMajorMinor.
 * Last 5 VIN chars, leading digits (NSString.integerValue style), byte-swap the low 16 bits.
 * Confirmed against the live advertisement: VIN …844019 -> minor 62379 (0xF3AB), major 0.
 */
fun expectedBeaconMinor(vin: String): Int? {
  if (vin.length < 5) return null
  val leadingDigits = vin.takeLast(5).takeWhile { it.isDigit() }
  val v = leadingDigits.toLongOrNull() ?: 0L
  val lower = (v and 0xFFFF).toInt()
  return ((lower and 0xFF) shl 8) or ((lower shr 8) and 0xFF)
}

fun vehicleLocalName(vin: String): String {
  val digest = MessageDigest.getInstance("SHA-1").digest(vin.toByteArray(Charsets.UTF_8))
  val hex = digest.take(8).joinToString("") { "%02x".format(it) }
  return "S${hex}C"
}
