package expo.modules.bgtask

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

/**
 * Android counterpart of iOS's `UIApplication.beginBackgroundTask`.
 *
 * The contract (modules/expo-bg-task/index.ts) is "let work started just before backgrounding
 * run to completion". The platforms get there differently: iOS SUSPENDS a backgrounded process
 * and the assertion buys ~30s of reprieve, whereas Android keeps the process running and only
 * Dozes it later. A `PARTIAL_WAKE_LOCK` on the same 30s ceiling is therefore the proportionate
 * equivalent for our 25s command deadline — it holds the CPU without the heavier machinery of a
 * foreground service, which is reserved for the always-on BLE central (expo-passive-entry).
 *
 * The lock is NOT reference-counted and is always acquired with a timeout, so a lost
 * `endBackgroundTask` (JS crash, reload) can never pin the CPU indefinitely.
 */
class BgTaskModule : Module() {
  private val locks = mutableMapOf<Int, PowerManager.WakeLock>()
  private val nextId = AtomicInteger(1)

  override fun definition() = ModuleDefinition {
    Name("BgTask")

    Function("beginBackgroundTask") { name: String ->
      val pm = appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm == null) {
        // Mirror iOS's "assertion refused" path: the contract says return null and let the
        // caller proceed without one.
        return@Function null
      }
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:$name").apply {
        setReferenceCounted(false)
        acquire(TIMEOUT_MS)
      }
      val id = nextId.getAndIncrement()
      synchronized(locks) { locks[id] = lock }
      id
    }

    Function("endBackgroundTask") { id: Int ->
      // Idempotent, and safe with an id that already timed out or was never valid — same
      // guarantee the TS wrapper documents for iOS.
      val lock = synchronized(locks) { locks.remove(id) }
      if (lock != null && lock.isHeld) lock.release()
    }

    OnDestroy {
      synchronized(locks) {
        locks.values.forEach { if (it.isHeld) it.release() }
        locks.clear()
      }
    }
  }

  private companion object {
    /** Matches the iOS assertion's ~30s, comfortably over our 25s command deadline. */
    const val TIMEOUT_MS = 30_000L
  }
}
