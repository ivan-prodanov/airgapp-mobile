import ExpoModulesCore

public class ExpoGodotViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoGodotView")

    // Godot → host. Carries an opaque JSON envelope string in `message`.
    Events("onGodotMessage")

    OnCreate {
      GodotBridge.shared.onMessageToHost = { [weak self] json in
        self?.sendEvent("onGodotMessage", ["message": json])
      }
    }

    OnDestroy {
      GodotBridge.shared.onMessageToHost = nil
    }

    // Host → Godot. `message` is a JSON envelope string `{ "type": ..., "data": ... }`.
    // No-op on the simulator (no engine).
    Function("sendMessageToGodot") { (message: String) in
      GodotBridge.shared.addMessage(message)
    }

    View(ExpoGodotView.self) {
      Prop("sceneName") { (view: ExpoGodotView, name: String?) in
        view.sceneName = name
      }
      // True only when the host wants drag-to-orbit on this view (currently the Controls screen).
      // Off elsewhere so GLView's touchesBegan stays blocked (root-cause workaround).
      Prop("orbitEnabled") { (view: ExpoGodotView, enabled: Bool?) in
        view.orbitEnabled = enabled ?? false
      }
    }
  }
}
