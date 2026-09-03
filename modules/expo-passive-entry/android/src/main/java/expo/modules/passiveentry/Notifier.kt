package expo.modules.passiveentry

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Local notifications posted from NATIVE code — the counterpart of ios/Notifier.swift. Two channels:
 * the foreground service's persistent, silent, low-importance card, and high-importance alerts
 * (Bluetooth off, child detected). Copy is the official app's (RESPONSE-13), same as iOS.
 *
 * Android 13+ gates every notification on the POST_NOTIFICATIONS runtime permission; the module
 * asks once alongside the BLE grants. A denial only mutes the reminders — the foreground service
 * still runs (Android shows its card in the notification shade regardless, unless the user hid
 * the channel).
 */
object Notifier {
  const val CHANNEL_SERVICE = "phone_key_service"
  const val CHANNEL_ALERTS = "phone_key_alerts"
  const val ID_SERVICE = 333
  const val ID_BT_OFF = 444
  const val ID_CPD = 445

  fun ensureChannels(ctx: Context) {
    NotificationManagerCompat.from(ctx).createNotificationChannelsCompat(
      listOf(
        NotificationChannelCompat.Builder(CHANNEL_SERVICE, NotificationManagerCompat.IMPORTANCE_LOW)
          .setName("Phone Key")
          .setDescription("Keeps the Bluetooth link to your car alive so it unlocks as you walk up")
          .setShowBadge(false)
          .build(),
        NotificationChannelCompat.Builder(CHANNEL_ALERTS, NotificationManagerCompat.IMPORTANCE_HIGH)
          .setName("Phone Key alerts")
          .setDescription("Bluetooth turned off, child detected in car")
          .build(),
      ),
    )
  }

  /** The foreground service card. [vin]'s last 6 characters name the car; [text] is the link state. */
  fun serviceNotification(ctx: Context, vin: String, text: String): Notification {
    ensureChannels(ctx)
    return NotificationCompat.Builder(ctx, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.ic_stat_phone_key)
      .setContentTitle("Phone Key")
      .setContentText(text)
      .setSubText("…${vin.takeLast(6)}")
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(launchIntent(ctx))
      .build()
  }

  fun postBtOff(ctx: Context) =
    post(ctx, ID_BT_OFF, "Bluetooth Disabled", "Phone Key will not work until Bluetooth is enabled")

  fun clearBtOff(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_BT_OFF)

  /** No debounce, like iOS: a child-in-car warning SHOULD keep nagging; a repeat replaces + re-alerts. */
  fun postCpd(ctx: Context) = post(ctx, ID_CPD, "Child detected in car", "Return to your vehicle immediately.")

  fun canPost(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun post(ctx: Context, id: Int, title: String, body: String) {
    if (!canPost(ctx)) return
    ensureChannels(ctx)
    val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
      .setSmallIcon(R.drawable.ic_stat_phone_key)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setAutoCancel(true)
      .setContentIntent(launchIntent(ctx))
      .build()
    runCatching { NotificationManagerCompat.from(ctx).notify(id, n) }
  }

  private fun launchIntent(ctx: Context): PendingIntent? {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
