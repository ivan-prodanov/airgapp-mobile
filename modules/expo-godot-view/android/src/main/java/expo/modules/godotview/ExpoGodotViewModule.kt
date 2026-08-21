package expo.modules.godotview

import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS <-> Godot bridge. Mirrors `ios/ExpoGodotViewModule.swift`; the JS contract
 * (`sendMessageToGodot` + the `onGodotMessage` event) is identical on both platforms.
 */
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
      GodotBridge.clear()
    }

    // Host → Godot. `message` is a JSON envelope string `{ "type": ..., "data": ... }`, drained by
    // MobileComm.gd through AndroidGodotInterface.pendingMessagesCount()/getMessage().
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
