package expo.modules.godotview

import android.app.Activity
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import java.io.File
import org.godotengine.godot.Godot

/**
 * Boots and owns one Godot engine instance, and hands back a view to embed — the Android
 * counterpart of `ios/GodotHost.mm`.
 *
 * BOOT ORDER (this is the whole job, and it is order-sensitive):
 *   1. `Godot(activity)` + `setCommandLine(argv)` — argv is `{exe, --main-pack, <abs pck path>}`,
 *      the same shape GodotHost.mm builds at its line 76.
 *   2. `godot.create()` on the MAIN thread → `GodotLib.initialize(...)`, which calls back into
 *      `onVideoInit()` and builds the GLSurfaceView.
 *   3. `onVideoInit` itself queues `GodotLib.setup(argv)` onto the GL thread and registers the
 *      plugins after it — see the comment there.
 * Doing (2) off the main thread, or reading `containerLayout` before it returns, gets you a null
 * view and no engine.
 *
 * ONE ENGINE PER PROCESS. Godot 3.2 keeps its state in process-wide C++ globals; a second
 * `GodotLib.initialize` in the same process does not give you a second engine, it corrupts the
 * first. React Native will happily mount `<ExpoGodotView />` twice (a remount, two screens), so
 * the instance is a singleton here and views attach to whatever already exists.
 */
object GodotHost {
  private const val TAG = "GodotHost"

  /** The pack, pushed next to the app's other data. Mirrors the iOS bundle path role. */
  const val PCK_NAME = "airgapp.pck"

  private var godot: Godot? = null
  private var started = false

  val isStarted: Boolean get() = started

  /** Absolute path the deploy script pushes the pack to. */
  fun pckPath(activity: Activity): String = File(activity.filesDir, PCK_NAME).absolutePath

  /**
   * Boot the engine if it is not already up, and return its view tree.
   *
   * Returns null when the pack is missing — the caller shows a placeholder rather than booting an
   * engine with no content, which in Godot 3.2 is a hard native abort rather than an exception.
   */
  @Synchronized
  fun start(activity: Activity, widthPx: Int, heightPx: Int): FrameLayout? {
    godot?.let { return it.containerLayout }

    val pck = pckPath(activity)
    if (!File(pck).exists()) {
      Log.w(TAG, "no pack at $pck — run scripts/android/deploy-godot.sh; not booting the engine")
      return null
    }

    val g = Godot(activity)
    // argv[0] is conventionally the executable; Godot only cares that it exists.
    //
    // --resolution IS REQUIRED, and its absence is not a subtle bug. project.godot declares
    // window/size 790x875 with no stretch mode, so Godot's default (stretch disabled) renders the
    // viewport at exactly that size, anchored top-left, and simply ignores the rest of the
    // surface. On device that looked like a tiny car in the corner (observed 2026-08-21).
    //
    // iOS never hits this because iphone_main(w, h, ...) seeds the OS window size BEFORE
    // Main::setup() runs, so the project value is overridden at boot. GodotLib.setup() takes no
    // size, and the later GodotLib.resize() only moves the OS window — with stretch disabled the
    // viewport does not follow. --resolution is the equivalent seeding, applied by main.cpp:554
    // while it parses argv, i.e. before the project settings are read.
    g.setCommandLine(
      arrayOf("airgapp", "--main-pack", pck, "--resolution", "${widthPx}x${heightPx}"),
    )
    Log.i(TAG, "booting engine, pck=$pck, resolution=${widthPx}x${heightPx}")
    g.create()

    val layout = g.containerLayout
    if (layout == null) {
      Log.e(TAG, "engine did not produce a view — onVideoInit was never called by the native layer")
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
    val layout = godot?.containerLayout ?: return
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

  @Synchronized
  fun onResume() {
    godot?.onResume()
  }

  @Synchronized
  fun onPause() {
    godot?.onPause()
  }
}
