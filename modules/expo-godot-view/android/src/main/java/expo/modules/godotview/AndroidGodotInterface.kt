package expo.modules.godotview

import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin

/**
 * The engine singleton `MobileComm.gd` binds to on Android.
 *
 * Tesla's own GDScript already looks for us by this exact name — `MobileComm.gd:25` reads
 * `if Engine.has_singleton("AndroidGodotInterface")` — so NO GDScript change and no `.pck`
 * re-export is needed. `getPluginName()` must return that string verbatim.
 *
 * Contract is the exact mirror of `ios/IOSGodotInterface.mm`:
 *   sendMessage(json)        Godot → host  → GodotBridge.sendMessage (→ onGodotMessage RN event)
 *   pendingMessagesCount()   GDScript polls the host→Godot queue
 *   getMessage()             GDScript drains it
 *
 * Unlike iOS — where the singleton is a C++ `Object` compiled into the app and registered with
 * `Engine::add_singleton`, which is why the iOS embed has to link the engine statically — Godot
 * 3.2.2's Android plugin system registers a plain Java object:
 * `GodotPlugin.onRegisterPluginWithGodotNative()` calls `nativeRegisterSingleton(name, this)`.
 * So this costs no engine rebuild and no C++ at all.
 *
 * Methods listed in getPluginMethods() are reflected over by the registry, so their names must
 * match the functions below exactly.
 */
class AndroidGodotInterface(godot: Godot) : GodotPlugin(godot) {
  override fun getPluginName() = "AndroidGodotInterface"

  override fun getPluginMethods(): MutableList<String> =
    mutableListOf("sendMessage", "pendingMessagesCount", "getMessage")

  fun sendMessage(json: String) = GodotBridge.sendMessage(json)

  fun pendingMessagesCount(): Int = GodotBridge.pendingMessagesCount()

  /** Never null: GDScript expects a String, and an empty string is the "queue empty" sentinel. */
  fun getMessage(): String = GodotBridge.getMessage() ?: ""
}
