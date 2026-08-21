package expo.modules.godotview

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Android stub for `<ExpoGodotView />` — no engine yet; Android Godot embedding is Phase 6.
 *
 * The background is TRANSPARENT, deliberately. The iOS *simulator* stub paints an opaque
 * 50% gray, which is fine there because it is a developer-only build — but this view is
 * full-bleed behind the app's scrolling content, and the content's opacity ramps with
 * scroll. An opaque slab therefore reads as "the whole app is washed light gray at the top,
 * and fades to the real colours as you scroll" (reported on device 2026-08-21). On iPhone
 * you never see it because the engine is drawing a car there.
 *
 * Transparent composites against whatever sits behind — the themed root background — so the
 * area reads as empty space and follows light/dark automatically, rather than hardcoding a
 * theme colour here that would drift from the theme.
 */
class ExpoGodotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val label = TextView(context).apply {
    gravity = Gravity.CENTER
    // Dim: this is a placeholder, not content. Bright white read as a UI element.
    setTextColor(Color.argb(64, 255, 255, 255))
    textSize = 11f
  }

  var sceneName: String? = null
    set(value) {
      field = value
      refresh()
    }

  init {
    val container = LinearLayout(context).apply {
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.TRANSPARENT)
    }
    container.addView(label)
    addView(container)
    refresh()
  }

  private fun refresh() {
    label.text = "Godot view — Android stub\nscene: ${sceneName ?: "—"}"
  }
}
