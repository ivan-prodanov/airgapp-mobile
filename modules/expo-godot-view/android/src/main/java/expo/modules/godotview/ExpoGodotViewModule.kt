package expo.modules.godotview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoGodotViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoGodotView")

    Function("hello") {
      "Hello world! 👋"
    }

    View(ExpoGodotView::class) {
      // Defines an event that the view can send to JavaScript.
      Events("onTap")
    }
  }
}
