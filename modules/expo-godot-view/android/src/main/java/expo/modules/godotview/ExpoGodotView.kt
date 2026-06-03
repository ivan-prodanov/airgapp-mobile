package expo.modules.godotview

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class ExpoGodotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onTap by EventDispatcher<Unit>()

  init {
    val container = LinearLayout(context).apply {
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#aabbcc"))
    }
    val label = TextView(context).apply {
      text = "ExpoGodotView - native view\nTap the view to emit a view event"
      gravity = Gravity.CENTER
    }
    container.addView(label)
    addView(container)
    setOnClickListener {
      onTap(Unit)
    }
  }
}
