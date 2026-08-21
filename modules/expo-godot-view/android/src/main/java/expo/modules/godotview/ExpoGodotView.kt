package expo.modules.godotview

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * `<ExpoGodotView />` on Android — hosts the engine's view tree, or an inert placeholder when the
 * engine cannot start.
 *
 * The background is TRANSPARENT in the placeholder case, deliberately. This view is full-bleed
 * behind the app's scrolling content and that content's opacity ramps with scroll, so an opaque
 * placeholder reads as "the whole app is washed grey at the top, fading to the real colours as you
 * scroll" (reported on device 2026-08-21). Transparent composites against the themed root instead.
 *
 * ONE ENGINE PER PROCESS: Godot 3.2 keeps state in process-wide C++ globals, so GodotHost is a
 * singleton and this view adopts whatever already exists. React Native remounts views freely
 * (navigation, fast refresh); each remount re-parents the same engine view rather than booting a
 * second one, which would corrupt the first.
 */
class ExpoGodotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val placeholder = TextView(context).apply {
    gravity = Gravity.CENTER
    setTextColor(Color.argb(64, 255, 255, 255))
    textSize = 11f
  }

  private var attachedEngineView = false

  var sceneName: String? = null
    set(value) {
      field = value
      refreshPlaceholder()
    }

  init {
    setBackgroundColor(Color.TRANSPARENT)
    addView(
      placeholder,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )
    refreshPlaceholder()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attachEngine()
  }

  /**
   * The engine needs its resolution at BOOT (see GodotHost's --resolution note), and a view has no
   * size until it is laid out — onAttachedToWindow routinely reports 0x0. So boot on the first
   * real size instead, which is also what the iOS host does (it reads parentView.bounds).
   */
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // POST, do not attach inline. onSizeChanged runs DURING a layout pass, and a child added mid
    // pass is not measured by it — the GLSurfaceView then sits at 0x0 forever, so
    // onSurfaceCreated never fires, so the GL-thread GodotLib.setup() never runs and the engine
    // produces no output at all. (Observed 2026-08-21: "GodotHost: engine up" followed by total
    // silence and a 0,0-0,0 GodotView.) Posting runs the attach after layout settles.
    if (w > 0 && h > 0) post { attachEngine(); requestLayout() }
  }

  private fun attachEngine() {
    if (attachedEngineView) return
    if (width <= 0 || height <= 0) return // not laid out yet; onSizeChanged will call us back
    val activity = appContext.currentActivity ?: return

    // Detach first: the singleton engine view may still be parented to a previous instance of
    // this view (a remount). Adding a view that already has a parent throws.
    GodotHost.detachFromParent()

    val engineView = GodotHost.start(activity, width, height)
    if (engineView == null) {
      refreshPlaceholder()
      return
    }
    removeView(placeholder)
    addView(engineView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

    // Measure and lay the child out RIGHT NOW rather than waiting for a pass that may never come.
    // Our onLayout only runs when Fabric lays this view out, and Fabric already did that before
    // we added the child — nothing in the shadow tree changed, so no further pass is scheduled and
    // requestLayout() on a Fabric-managed view does not force one. The child would sit at 0x0.
    //
    // That is fatal, not cosmetic: GLSurfaceView starts its GL thread only once the surface is
    // created, which needs a non-zero size. No GL thread means the queueEvent'd GodotLib.setup()
    // never runs, and the engine reports "up" while producing no output whatsoever.
    engineView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    engineView.layout(0, 0, width, height)

    attachedEngineView = true
    GodotHost.onResume()
    // Re-assert the size once the engine has had a moment to finish Main::setup(); see
    // GodotHost.resize for why the surface-time resize alone is not enough.
    postDelayed({ GodotHost.resize(width, height) }, 1_500)
  }

  override fun onDetachedFromWindow() {
    if (attachedEngineView) {
      // Leave the engine running — it is process-wide and another mount may adopt it — but drop
      // our reference so a re-attach re-parents cleanly.
      GodotHost.detachFromParent()
      attachedEngineView = false
    }
    super.onDetachedFromWindow()
  }

  /**
   * Lay every child out to fill us.
   *
   * ExpoView does not lay out children added natively — Fabric only knows about React children, so
   * a view we addView() ourselves is never measured and sits at 0x0. That is not cosmetic here: a
   * GLSurfaceView at 0x0 never fires onSurfaceCreated, so the GL-thread GodotLib.setup() never
   * runs and the engine stays silent with no error (observed 2026-08-21 — "engine up" followed by
   * nothing at all). Doing the layout ourselves makes it independent of WHEN the child was added.
   */
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    for (i in 0 until childCount) {
      getChildAt(i).layout(0, 0, w, h)
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    val w = MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY)
    val h = MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY)
    for (i in 0 until childCount) {
      getChildAt(i).measure(w, h)
    }
  }

  private fun refreshPlaceholder() {
    placeholder.text = if (GodotHost.isStarted) {
      ""
    } else {
      "Godot engine not started\nscene: ${sceneName ?: "—"}\n(no ${GodotHost.PCK_NAME} pushed)"
    }
  }
}
