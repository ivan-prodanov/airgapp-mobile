package expo.modules.godotview

import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoGodotViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoGodotView")

    // Godot → host. Carries an opaque JSON envelope string in `message`.
    Events("onGodotMessage")

    OnCreate {
      GodotBridge.onMessageToHost = { json -> sendEvent("onGodotMessage", bundleOf("message" to json)) }
    }

    OnDestroy {
      GodotBridge.onMessageToHost = null
    }

    // Host → Godot. `message` is a JSON envelope string `{ "type": ..., "data": ... }`.
    Function("sendMessageToGodot") { message: String ->
      GodotBridge.addMessage(message)
    }

    View(ExpoGodotView::class) {
      Prop("sceneName") { view: ExpoGodotView, name: String? ->
        view.sceneName = name
      }
    }
  }
}
