package expo.modules.passiveentry

import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The foreground service that keeps the phone key alive — Android's replacement for CoreBluetooth
 * state restoration. While it runs, the process is never cached-frozen or Doze-throttled out of its
 * GATT callbacks, and a swipe from recents does not end it (`onTaskRemoved` is a no-op, like the
 * official app's `BLEService` when background is allowed). It owns nothing itself: the runtime's
 * central is armed in onStartCommand and the card just reflects its state.
 *
 * Started by: `start(vin)` from JS (app visible), PassiveEntryBootReceiver (boot / package update),
 * and best-effort from a background sighting. Stopped by `stop()` (disarm).
 */
class PassiveEntryService : Service() {
  private var btReceiver: BroadcastReceiver? = null

  override fun onCreate() {
    super.onCreate()
    Notifier.ensureChannels(this)
    val rt = PassiveEntryRuntime.ensure(this)
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
          BluetoothAdapter.STATE_ON -> rt.onBluetoothState(true)
          BluetoothAdapter.STATE_OFF -> rt.onBluetoothState(false)
        }
      }
    }
    ContextCompat.registerReceiver(this, r, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
    btReceiver = r
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val rt = PassiveEntryRuntime.ensure(this)
    val vin = rt.store.vin
    if (vin == null || !BleGuards.hasScanPermissions(this)) {
      rt.log.log("service: nothing armed or BLE permissions missing — stopping")
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        Notifier.ID_SERVICE,
        Notifier.serviceNotification(this, vin, "Waiting for your car"),
        if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
      )
    } catch (e: Exception) {
      rt.log.log("startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    rt.log.log("service: foreground (reason=${intent?.getStringExtra(EXTRA_REASON) ?: "system restart"})")
    rt.onServiceRunning(vin)
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    PassiveEntryRuntime.peek()?.log?.log("task removed — service keeps running")
  }

  override fun onDestroy() {
    btReceiver?.let { runCatching { unregisterReceiver(it) } }
    btReceiver = null
    PassiveEntryRuntime.peek()?.let { it.onServiceStopped(); it.log.log("service: destroyed") }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val EXTRA_REASON = "reason"
  }
}
