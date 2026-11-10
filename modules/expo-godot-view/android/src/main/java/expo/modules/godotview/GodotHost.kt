package expo.modules.godotview

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.fragment.app.FragmentActivity
import android.view.ViewGroup
import android.widget.FrameLayout
import java.io.File
import org.godotengine.godot.Godot

/**
 * Boots and owns one Godot engine instance, and hands back a view to embed — the Android
 * counterpart of `ios/GodotHost.mm`.
 *
 * BOOT ORDER (order-sensitive):
 *   1. `Godot()` + `setCommandLine(argv)` — argv is `{exe, --main-pack, <abs pck>, --resolution}`,
 *      the same shape GodotHost.mm builds at its line 76.
 *   2. Add it to the FragmentManager with `commitNow()`. That synchronously runs `onCreateView`,
 *      which calls `GodotLib.initialize(...)`, which calls back into `onVideoInit()` and builds
 *      the GLSurfaceView.
 *   3. `onVideoInit` queues `GodotLib.setup(argv)` onto the GL thread and registers the plugins
 *      after it — see the comment there.
 * `commit()` instead of `commitNow()` returns before the view exists.
 *
 * WHY A FRAGMENT: a Fragment owns its view independently of the React Native view tree, so RN can
 * detach and re-attach around it without tearing the surface down. This mirrors the official Tesla
 * app, which runs the SAME engine build (3.2.2.stable.custom vs our .official) with `TMGodot
 * extends Godot` added as `godot_fragment`. As a plain view owned by RN, the re-attached surface
 * kept a stale compositing layer and the car silently vanished after any navigation.
 *
 * ONE ENGINE PER PROCESS. Godot 3.2 keeps its state in process-wide C++ globals; a second
 * `GodotLib.initialize` in the same process does not give you a second engine, it corrupts the
 * first. React Native will happily mount `<ExpoGodotView />` twice (a remount, two screens), so
 * the instance is a singleton here and views attach to whatever already exists.
 */
object GodotHost {
  private const val TAG = "GodotHost"

  /** The pack, next to the app's other data. Mirrors the iOS bundle path role. */
  const val PCK_NAME = "airgapp.pck"

  /** Marker file recording the app versionCode the bundled pack was last extracted for. */
  private const val PCK_VERSION_MARKER = "airgapp.pck.ver"

  /** Matches the tag the official Tesla app uses for the same fragment. */
  private const val FRAGMENT_TAG = "godot_fragment"

  private var godot: Godot? = null
  private var started = false

  @Volatile private var extractionInProgress = false
  private var onPackReady: (() -> Unit)? = null

  val isStarted: Boolean get() = started

  /** True while the bundled pack is being copied out of the APK on first launch. */
  val isExtracting: Boolean get() = extractionInProgress

  /** Absolute path the engine reads the pack from (also where deploy-godot.sh pushes it for dev). */
  fun pckPath(activity: Activity): String = File(activity.filesDir, PCK_NAME).absolutePath

  /**
   * Make sure the scene pack is present at [pckPath] before the engine boots, then run [onReady] on
   * the main thread. Three cases:
   *
   *  - **Already present and current** → [onReady] runs immediately (synchronously).
   *  - **Bundled in the APK** (a `-Pairgapp.distribution` build) but missing or stale → copy it out
   *    of `assets/` on a background thread (~320 MB, a few seconds), then [onReady] on the main
   *    thread. [isExtracting] is true meanwhile so the view can show a "preparing" placeholder.
   *  - **Not bundled and not present** (a dev build before scripts/android/deploy-godot.sh) →
   *    [onReady] runs immediately; start() then returns null and the placeholder says so.
   *
   * Safe to call on every remount: the copy runs at most once, and the most recent caller's
   * [onReady] is the one invoked when it finishes (a view that remounted during extraction wins).
   */
  @Synchronized
  fun ensurePack(activity: Activity, onReady: () -> Unit) {
    val dest = File(activity.filesDir, PCK_NAME)
    if (dest.exists() && isPackCurrent(activity)) { onReady(); return }
    if (!isPackBundled(activity)) { onReady(); return }

    onPackReady = onReady
    if (extractionInProgress) return
    extractionInProgress = true

    val appContext = activity.applicationContext
    val handler = Handler(Looper.getMainLooper())
    Thread({
      val ok = try {
        extractBundledPack(appContext, dest)
      } catch (e: Throwable) {
        Log.e(TAG, "pack extraction failed", e)
        false
      }
      handler.post {
        extractionInProgress = false
        val cb = onPackReady
        onPackReady = null
        if (!ok) Log.e(TAG, "pack not extracted — engine will show the placeholder")
        cb?.invoke()
      }
    }, "godot-pack-extract").start()
  }

  /** Is airgapp.pck bundled in the APK's assets (true only for a distribution build)? */
  private fun isPackBundled(context: Context): Boolean =
    try { context.assets.list("")?.contains(PCK_NAME) == true } catch (e: Exception) { false }

  /** Does the extracted pack match the currently-installed app version (vs a stale older one)? */
  private fun isPackCurrent(context: Context): Boolean {
    val marker = File(context.filesDir, PCK_VERSION_MARKER)
    if (!marker.exists()) return false
    return try { marker.readText().trim() == currentVersionCode(context) } catch (e: Exception) { false }
  }

  private fun currentVersionCode(context: Context): String = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    @Suppress("DEPRECATION")
    val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
    code.toString()
  } catch (e: Exception) { "?" }

  /**
   * Copy the APK-bundled pack to [dest] atomically (temp file + rename), then write the version
   * marker. Runs on a background thread. Returns true when a non-empty pack is in place.
   */
  private fun extractBundledPack(context: Context, dest: File): Boolean {
    val tmp = File(context.filesDir, "$PCK_NAME.tmp")
    Log.i(TAG, "extracting bundled $PCK_NAME → ${dest.absolutePath}")
    val startMs = System.currentTimeMillis()
    tmp.delete()
    context.assets.open(PCK_NAME).use { input ->
      tmp.outputStream().use { output -> input.copyTo(output, 1 shl 20) }
    }
    if (dest.exists()) dest.delete()
    if (!tmp.renameTo(dest)) {
      tmp.copyTo(dest, overwrite = true)
      tmp.delete()
    }
    File(context.filesDir, PCK_VERSION_MARKER).writeText(currentVersionCode(context))
    val ok = dest.exists() && dest.length() > 0
    Log.i(TAG, "extracted $PCK_NAME: ${dest.length()} bytes in ${System.currentTimeMillis() - startMs} ms (ok=$ok)")
    return ok
  }

  /**
   * Boot the engine if it is not already up, and return its view tree.
   *
   * Returns null when the pack is missing — the caller shows a placeholder rather than booting an
   * engine with no content, which in Godot 3.2 is a hard native abort rather than an exception.
   */
  @Synchronized
  fun start(activity: Activity, widthPx: Int, heightPx: Int): FrameLayout? {
    // containerLayout, NOT getView(). Fragment.onDestroyView() nulls the Fragment's own view
    // reference when its host Activity goes away — and the Activity IS destroyed when the user
    // backs out to the launcher while the process lives on. getView() then returns null, start()
    // returned null, and the relaunched app showed no car at all ("start() returned null",
    // measured 2026-08-21). Our containerLayout field survives that, and so does the GodotView
    // inside it with its GL thread and EGL context — which is the whole point: re-parenting it
    // into the new Activity's host gives it a fresh Surface on the SAME context, so
    // GodotLib.newcontext() is never called a second time and the engine never notices.
    godot?.let { return it.containerLayout }

    if (activity !is FragmentActivity) {
      Log.e(TAG, "host activity is not a FragmentActivity — cannot add the Godot fragment")
      return null
    }

    val pck = pckPath(activity)
    if (!File(pck).exists()) {
      Log.w(TAG, "no pack at $pck — run scripts/android/deploy-godot.sh; not booting the engine")
      return null
    }

    val g = Godot()
    // argv[0] is conventionally the executable; Godot only cares that it exists.
    //
    // --resolution IS REQUIRED. project.godot declares window/size 790x875 with no stretch mode,
    // so Godot's default renders the viewport at exactly that size anchored top-left and ignores
    // the rest of the surface — on device, a tiny car in the corner. iOS never hits this because
    // iphone_main(w, h, ...) seeds the window size before Main::setup(); GodotLib.setup() takes no
    // size, and a later resize() only moves the OS window. main.cpp:554 applies --resolution while
    // parsing argv, i.e. before the project settings are read.
    g.setCommandLine(
      arrayOf("airgapp", "--main-pack", pck, "--resolution", "${widthPx}x${heightPx}"),
    )
    Log.i(TAG, "booting engine, pck=$pck, resolution=${widthPx}x${heightPx}")

    // commitNow(), not commit(): we need getView() synchronously, and onCreateView is what boots
    // the engine. Added WITHOUT a container id — the fragment owns the view, and the React Native
    // host re-parents it. That ownership is the whole point of the Fragment shape: RN can detach
    // and re-attach the view tree without the surface being torn down.
    activity.supportFragmentManager
      .beginTransaction()
      .add(g, FRAGMENT_TAG)
      .commitNow()

    val layout = g.containerLayout
    if (layout == null) {
      Log.e(TAG, "fragment produced no view — onVideoInit was never called by the native layer")
      return null
    }
    godot = g
    started = true
    Log.i(TAG, "engine up")
    return layout
  }

  /** Detach the engine's view from whatever currently holds it, so a new host can adopt it. */
  @Synchronized
  fun detachFromParent() {
    val layout = godot?.containerLayout as? ViewGroup ?: return
    (layout.parent as? ViewGroup)?.removeView(layout)
  }

  /**
   * Re-assert the display size on the render thread AFTER the engine has finished booting.
   *
   * GodotRenderer.onSurfaceChanged calls GodotLib.resize() as soon as the surface exists, which
   * can land before Main::setup() has read the project settings — at which point the project's
   * declared window/size (790x875 here) wins and the render occupies only part of the surface.
   * Re-sending it once the engine is up is idempotent when the size already matches.
   */
  @Synchronized
  fun resize(widthPx: Int, heightPx: Int) {
    val g = godot ?: return
    Log.i(TAG, "re-asserting display size ${widthPx}x${heightPx} post-setup")
    g.runOnRenderThread { org.godotengine.godot.GodotLib.resize(widthPx, heightPx) }
  }

  // onResume/onPause are the FragmentManager's job now — calling Fragment lifecycle methods by
  // hand would double-invoke them. Kept out deliberately.
}
