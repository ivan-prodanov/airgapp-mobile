package expo.modules.godotview

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Android stub for `<ExpoGodotView />` — gray placeholder, no engine. Android Godot embedding is
 * Phase 6. Mirrors the iOS simulator stub.
 */
class ExpoGodotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val label = TextView(context).apply {
    gravity = Gravity.CENTER
    setTextColor(Color.WHITE)
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
      setBackgroundColor(Color.parseColor("#808080")) // gray placeholder
    }
    container.addView(label)
    addView(container)
    refresh()
  }

  private fun refresh() {
    label.text = "Godot view — Android stub\nscene: ${sceneName ?: "—"}"
  }
}
