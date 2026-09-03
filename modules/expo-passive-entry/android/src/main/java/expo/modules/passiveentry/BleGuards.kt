package expo.modules.passiveentry

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * The runtime-permission gate for BLE. Mirrors src/ble/blePermissions.ts (node-tested) so the two
 * cannot drift.
 *
 * This exists as an explicit precondition because the failure it prevents is INVISIBLE: on Android
 * 12+, starting a scan without BLUETOOTH_SCAN neither throws nor warns — it returns zero results
 * forever, indistinguishable from "the car isn't nearby". Better a clear refusal in the log.
 */
object BleGuards {
  fun requiredPermissions(): List<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  fun missingPermissions(context: Context): List<String> =
    requiredPermissions().filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }

  fun hasScanPermissions(context: Context): Boolean = missingPermissions(context).isEmpty()

  /** Asked once alongside the BLE grants, never REQUIRED: denying it only mutes the reminders. */
  fun optionalPermissions(context: Context): List<String> =
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      listOf(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      emptyList()
    }
}
