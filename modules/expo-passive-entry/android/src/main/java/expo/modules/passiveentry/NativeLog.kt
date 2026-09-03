package expo.modules.passiveentry

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Three sinks for every native line, like ios/PassiveEntryCentral.swift's log():
 *  - logcat (`adb logcat -s PassiveEntry:*`) — volatile, lost on reboot;
 *  - the JS `log` event, when a React context is alive (the app routes it into its SQLite ring);
 *  - `files/airgapp-native.log` — survives process death and reboot, the only record of what the
 *    service did while nothing else was running. Pull with `bash scripts/android/pull-logs.sh`.
 */
class NativeLog(context: Context) {
  private val file = File(context.applicationContext.filesDir, FILE_NAME)
  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "PassiveEntryLog").apply { isDaemon = true } }
  private val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)

  @Volatile var sink: ((String) -> Unit)? = null

  fun log(line: String) {
    Log.i(TAG, line)
    sink?.invoke(line)
    io.execute { append(line) }
  }

  private fun append(line: String) {
    runCatching {
      if (file.length() > MAX_BYTES) {
        val rotated = File(file.parentFile, "$FILE_NAME.1")
        rotated.delete()
        file.renameTo(rotated)
      }
      FileOutputStream(file, true).use { it.write("[native-passive] ${stamp.format(Date())} $line\n".toByteArray()) }
    }
  }

  companion object {
    const val TAG = "PassiveEntry"
    const val FILE_NAME = "airgapp-native.log"
    private const val MAX_BYTES = 1L shl 20
  }
}
