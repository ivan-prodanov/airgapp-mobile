import ExpoModulesCore

public class ExpoGodotViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoGodotView")

    Function("hello") {
      return "Hello world! 👋"
    }

    View(ExpoGodotView.self) {
      Events("onTap")
    }
  }
}
