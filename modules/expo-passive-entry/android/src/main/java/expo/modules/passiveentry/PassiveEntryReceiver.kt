package expo.modules.passiveentry

import android.app.PendingIntent
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.IntentCompat

/**
 * BOOT_COMPLETED / MY_PACKAGE_REPLACED → bring the service back. Exported (system broadcasts), and it
 * handles nothing else — every internal action goes to the non-exported receiver below. Delivered
 * only if the app has been opened at least once since install (Android's stopped-state rule): the
 * same ceiling as iOS after a force-quit.
 */
class PassiveEntryBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    PassiveEntryRuntime.ensure(context).startIfConfigured(action.substringAfterLast('.'))
  }
}

/** Internal actions: PendingIntent scan results and the three alarms. Not exported. */
class PassiveEntryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val rt = PassiveEntryRuntime.ensure(context)
    when (intent.action) {
      ACTION_SCAN_RESULTS -> {
        val error = intent.getIntExtra(BluetoothLeScanner.EXTRA_ERROR_CODE, -1)
        if (error != -1) {
          rt.log.log("background discovery error code=$error")
          return
        }
        val results = IntentCompat.getParcelableArrayListExtra(intent, BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
          ?: return
        // Keep the process alive while the connect lands (goAsync gives ~10 s beyond onReceive).
        val pending = goAsync()
        rt.handler.postDelayed({ runCatching { pending.finish() } }, 10_000L)
        rt.onPendingScanResults(results)
        rt.startIfConfigured("car sighted")
      }
      ACTION_SCAN_RESTART -> rt.onScanRestartAlarm()
      ACTION_REINIT -> rt.onReinitAlarm()
      ACTION_BT_OFF_REPEAT -> rt.onBtOffRepeatAlarm()
    }
  }

  companion object {
    const val ACTION_SCAN_RESULTS = "expo.modules.passiveentry.SCAN_RESULTS"
    const val ACTION_SCAN_RESTART = "expo.modules.passiveentry.SCAN_RESTART"
    const val ACTION_REINIT = "expo.modules.passiveentry.REINIT"
    const val ACTION_BT_OFF_REPEAT = "expo.modules.passiveentry.BT_OFF_REPEAT"

    /** A stable PendingIntent per action (same request code + explicit component → same object, so cancel/stopScan match). */
    fun pending(ctx: Context, action: String, mutable: Boolean): PendingIntent {
      val intent = Intent(ctx, PassiveEntryReceiver::class.java).setAction(action)
      val code = when (action) {
        ACTION_SCAN_RESULTS -> 1
        ACTION_SCAN_RESTART -> 2
        ACTION_REINIT -> 3
        else -> 4
      }
      // Scan-result intents MUST be mutable: the Bluetooth service fills in the results extra.
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
      return PendingIntent.getBroadcast(ctx, code, intent, flags)
    }
  }
}
