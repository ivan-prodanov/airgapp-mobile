package expo.modules.godotview

import android.app.Activity
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

  /** The pack, pushed next to the app's other data. Mirrors the iOS bundle path role. */
  const val PCK_NAME = "airgapp.pck"

  /** Matches the tag the official Tesla app uses for the same fragment. */
  private const val FRAGMENT_TAG = "godot_fragment"

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
