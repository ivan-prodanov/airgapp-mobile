package expo.modules.passiveentry

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * The process-wide owner of passive entry — the `PassiveEntryCentral.shared` of the Swift, plus the
 * pieces iOS gets from the OS for free: the foreground service, the boot/alarm/scan receivers, and
 * the "is the app really visible?" truth that gates the single-writer rule.
 *
 * Exactly one Instance per process. The main process runs PERSISTENT; the `:share` process (the
 * share sheet, see ShareActivity) runs EPHEMERAL and never touches the service or the store's VIN.
 */
object PassiveEntryRuntime {
  @Volatile private var instance: Instance? = null

  fun ensure(context: Context): Instance =
    instance ?: synchronized(this) { instance ?: Instance(context.applicationContext).also { instance = it } }

  fun peek(): Instance? = instance

  class Instance(val app: Context) {
    val mode: PassiveEntryCentral.Mode =
      if (currentProcessName(app).endsWith(":share")) PassiveEntryCentral.Mode.EPHEMERAL else PassiveEntryCentral.Mode.PERSISTENT
    val store = PassiveEntryStore(app)
    val log = NativeLog(app)
    private val thread = HandlerThread("PassiveEntry", Process.THREAD_PRIORITY_DEFAULT).apply { start() }
    val handler = Handler(thread.looper)

    @Volatile var visibleActivities = 0
      private set

    @Volatile var serviceRunning = false
      private set

    /** Module sink for the `connectionState` event. */
    @Volatile var onConnectionState: ((String, Int) -> Unit)? = null

    val central: PassiveEntryCentral = PassiveEntryCentral(
      context = app,
      mode = mode,
      store = store,
      logger = log,
      handler = handler,
      visible = { visibleActivities > 0 },
      responderFactory = if (mode == PassiveEntryCentral.Mode.PERSISTENT) { vin ->
        VcsecResponder(
          vin = vin,
          store = store,
          deviceKeyHex = { KeystoreKey.getKeyHex(app) },
          writeFramed = { central.writeFramed(it) },
          log = log::log,
          onCpdWarning = { Notifier.postCpd(app) },
        )
      } else null,
    )

    private var backgroundScanArmedAt = 0L

    init {
      central.onLinkState = { _, _ -> val (s, m) = central.connectionSnapshot(); onConnectionState?.invoke(s, m) }
      central.onStateChanged = { s -> handler.post { onCentralState(s) } }
    }

    // ── activity visibility (PassiveEntryApp) — the Android UIApplication.applicationState ──

    fun onActivityStarted() {
      visibleActivities += 1
      if (visibleActivities == 1) {
        central.onVisibilityChanged(true)
        if (mode == PassiveEntryCentral.Mode.PERSISTENT) disarmBackgroundDiscovery()
      }
    }

    fun onActivityStopped() {
      visibleActivities = maxOf(0, visibleActivities - 1)
      if (visibleActivities == 0 && mode == PassiveEntryCentral.Mode.PERSISTENT) {
        // The app is no longer visible: JS is about to stop listening (AppState → background). Flip
        // to autonomous natively as well, so the gate never depends on RN's timing.
        central.setPipeMode(false)
        central.onVisibilityChanged(false)
        handler.post { maybeArmBackgroundDiscovery() }
      }
    }

    // ── JS surface ─────────────────────────────────────────────────────────────

    fun start(vin: String) {
      when (mode) {
        PassiveEntryCentral.Mode.EPHEMERAL -> central.arm(vin)
        PassiveEntryCentral.Mode.PERSISTENT -> {
          store.vin = vin
          central.arm(vin)
          startService("start")
        }
      }
    }

    fun stop() {
      when (mode) {
        PassiveEntryCentral.Mode.EPHEMERAL -> central.disarm()
        PassiveEntryCentral.Mode.PERSISTENT -> {
          store.vin = null
          central.disarm()
          disarmBackgroundDiscovery()
          cancelAlarm(PassiveEntryReceiver.ACTION_REINIT)
          cancelAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT)
          Notifier.clearBtOff(app)
          app.stopService(Intent(app, PassiveEntryService::class.java))
        }
      }
    }

    /** The single-writer gate. Only a genuinely visible app may claim the pipe (iOS: only `.active`). */
    fun setForegroundResponderActive(active: Boolean) {
      if (mode == PassiveEntryCentral.Mode.EPHEMERAL) return
      if (active && visibleActivities == 0) {
        log.log("foreground claim REFUSED (no activity visible) — staying autonomous")
        return
      }
      central.setPipeMode(active)
    }

    // ── service / receiver surface ─────────────────────────────────────────────

    /** Resume from persistence with no JS: boot, package update, a background sighting. */
    fun startIfConfigured(reason: String) {
      if (mode != PassiveEntryCentral.Mode.PERSISTENT) return
      val vin = store.vin
      if (vin == null) {
        log.log("startIfConfigured($reason): no armed vin — idle")
        return
      }
      if (!BleGuards.hasScanPermissions(app)) {
        log.log("startIfConfigured($reason): BLE permissions missing — idle until the app is opened")
        return
      }
      log.log("startIfConfigured($reason): armed for vin=…${vin.takeLast(6)}")
      central.arm(vin)
      startService(reason)
    }

    private fun startService(reason: String) {
      if (serviceRunning) return
      try {
        ContextCompat.startForegroundService(
          app,
          Intent(app, PassiveEntryService::class.java).putExtra(PassiveEntryService.EXTRA_REASON, reason),
        )
      } catch (e: Exception) {
        // Android 12+ refuses a foreground-service start from the background outside the exempt
        // triggers. The central is armed in-process regardless; the next exempt trigger (boot, the
        // user opening the app) promotes it.
        log.log("foreground service start refused ($reason): ${e.javaClass.simpleName}: ${e.message}")
      }
    }

    fun onServiceRunning(vin: String) {
      serviceRunning = true
      central.arm(vin)
      scheduleAlarm(PassiveEntryReceiver.ACTION_REINIT, REINIT_INTERVAL_MS, REINIT_INTERVAL_MS / 2)
      handler.post { updateNotification(central.snapshot.state) }
    }

    fun onServiceStopped() {
      serviceRunning = false
    }

    fun onBluetoothState(on: Boolean) {
      if (on) {
        Notifier.clearBtOff(app)
        cancelAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT)
        store.btOffRepeatScheduled = false
        central.onBluetoothOn()
        return
      }
      // The Bluetooth service drops every scan registration with the radio: forget ours, or the next
      // arm trusts a registration that no longer exists until the 25-minute restart alarm.
      handler.post { backgroundScanArmedAt = 0L }
      central.onBluetoothOff()
      if (store.vin == null || store.btOffRepeatScheduled) return
      // Like iOS: one reminder per off-episode plus a repeat every few hours. Five seconds of grace,
      // like the official app, so a quick toggle does not nag.
      handler.postDelayed({
        if (adapterEnabled()) return@postDelayed
        Notifier.postBtOff(app)
        scheduleAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT, BT_OFF_REPEAT_MS, BT_OFF_REPEAT_MS / 4)
        store.btOffRepeatScheduled = true
      }, 5_000L)
    }

    fun onBtOffRepeatAlarm() {
      if (adapterEnabled() || store.vin == null) return
      Notifier.postBtOff(app)
      scheduleAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT, BT_OFF_REPEAT_MS, BT_OFF_REPEAT_MS / 4)
    }

    fun onReinitAlarm() {
      central.reinit("4h watchdog")
      if (serviceRunning) scheduleAlarm(PassiveEntryReceiver.ACTION_REINIT, REINIT_INTERVAL_MS, REINIT_INTERVAL_MS / 2)
    }

    fun onPendingScanResults(results: List<ScanResult>) {
      results.forEach { central.onExternalScanResult(it) }
    }

    fun onScanRestartAlarm() {
      handler.post {
        stopBackgroundScan()
        maybeArmBackgroundDiscovery()
      }
    }

    // ── background discovery: a PendingIntent scan that outlives the process ──

    private fun onCentralState(s: PassiveEntryCentral.State) {
      updateNotification(s)
      when {
        s == PassiveEntryCentral.State.READY || visibleActivities > 0 -> disarmBackgroundDiscovery()
        s == PassiveEntryCentral.State.DISCOVERING || s == PassiveEntryCentral.State.STANDING -> maybeArmBackgroundDiscovery()
      }
    }

    /**
     * The Android analog of the iOS beacon region: a hardware-filtered LOW_POWER scan whose results
     * are delivered to PassiveEntryReceiver by PendingIntent, so it keeps looking after the process
     * is gone and wakes us when the car (beacon | 1122 | name | address) appears. Re-issued every
     * 25 min by alarm because Android quietly stops delivering results for long-running scans.
     */
    private fun maybeArmBackgroundDiscovery() {
      if (mode != PassiveEntryCentral.Mode.PERSISTENT) return
      val vin = store.vin ?: return
      if (visibleActivities > 0) return
      val st = central.snapshot.state
      if (st != PassiveEntryCentral.State.DISCOVERING && st != PassiveEntryCentral.State.STANDING) return
      if (!BleGuards.hasScanPermissions(app)) return
      val scanner = adapter()?.bluetoothLeScanner ?: return
      if (backgroundScanArmedAt != 0L && SystemClock.elapsedRealtime() - backgroundScanArmedAt < BACKGROUND_SCAN_RESTART_MS - 60_000L) return
      val settings = central.scanSettings(ScanSettings.SCAN_MODE_LOW_POWER)
      val pi = PassiveEntryReceiver.pending(app, PassiveEntryReceiver.ACTION_SCAN_RESULTS, mutable = true)
      val rc = runCatching { scanner.startScan(central.backgroundScanFilters(), settings, pi) }.getOrElse { -1 }
      if (rc == 0) {
        backgroundScanArmedAt = SystemClock.elapsedRealtime()
        scheduleAlarm(PassiveEntryReceiver.ACTION_SCAN_RESTART, BACKGROUND_SCAN_RESTART_MS, 5 * 60_000L)
        log.log("background discovery armed (PendingIntent scan, low-power) for …${vin.takeLast(6)}")
      } else {
        log.log("background discovery could not start (code $rc)")
      }
    }

    private fun stopBackgroundScan() {
      if (backgroundScanArmedAt == 0L) return
      backgroundScanArmedAt = 0L
      runCatching {
        adapter()?.bluetoothLeScanner?.stopScan(PassiveEntryReceiver.pending(app, PassiveEntryReceiver.ACTION_SCAN_RESULTS, mutable = true))
      }
    }

    private fun disarmBackgroundDiscovery() {
      handler.post {
        if (backgroundScanArmedAt == 0L) return@post
        stopBackgroundScan()
        cancelAlarm(PassiveEntryReceiver.ACTION_SCAN_RESTART)
        log.log("background discovery stopped")
      }
    }

    // ── alarms (inexact; fine under Doze, no SCHEDULE_EXACT_ALARM needed) ─────

    private fun scheduleAlarm(action: String, delayMs: Long, windowMs: Long) {
      val am = app.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val pi = PassiveEntryReceiver.pending(app, action, mutable = false)
      runCatching { am.setWindow(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, windowMs, pi) }
    }

    private fun cancelAlarm(action: String) {
      val am = app.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      runCatching { am.cancel(PassiveEntryReceiver.pending(app, action, mutable = false)) }
    }

    // ── service card ───────────────────────────────────────────────────────────

    private fun updateNotification(s: PassiveEntryCentral.State) {
      if (!serviceRunning) return
      val vin = store.vin ?: return
      val text = when (s) {
        PassiveEntryCentral.State.READY -> "Connected to your car"
        PassiveEntryCentral.State.IDLE -> if (adapterEnabled()) "Waiting for your car" else "Bluetooth is off"
        else -> "Waiting for your car"
      }
      runCatching { NotificationManagerCompat.from(app).notify(Notifier.ID_SERVICE, Notifier.serviceNotification(app, vin, text)) }
    }

    private fun adapter() = (app.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter

    private fun adapterEnabled(): Boolean = adapter()?.isEnabled == true

    private companion object {
      const val REINIT_INTERVAL_MS = 4L * 60 * 60 * 1000
      const val BT_OFF_REPEAT_MS = 4L * 60 * 60 * 1000
      const val BACKGROUND_SCAN_RESTART_MS = 25L * 60 * 1000
    }
  }

  private fun currentProcessName(context: Context): String {
    if (Build.VERSION.SDK_INT >= 28) return Application.getProcessName()
    val pid = Process.myPid()
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    return am?.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName ?: context.packageName
  }
}
