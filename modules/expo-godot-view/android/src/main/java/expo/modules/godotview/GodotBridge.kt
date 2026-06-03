package expo.modules.godotview

/**
 * Android counterpart of the iOS `GodotBridge`. Pure no-op stub for now — Android Godot is
 * Phase 6 (Tesla shipped `AndroidGodotInterface`; we'll wire it later). Kept in sync with iOS
 * so the JS contract (`sendMessageToGodot` + `onGodotMessage`) is identical across platforms.
 */
object GodotBridge {
  /** Set by the module to forward Godot → host messages to JS as `onGodotMessage`. */
  var onMessageToHost: ((String) -> Unit)? = null

  private val outbound = ArrayDeque<String>()

  // host → Godot (called from JS via sendMessageToGodot)
  @Synchronized
  fun addMessage(json: String) {
    // No Godot engine on Android yet (Phase 6). No-op.
  }

  // called by the future AndroidGodotInterface on the engine thread
  @Synchronized
  fun pendingMessagesCount(): Int = outbound.size

  @Synchronized
  fun getMessage(): String? = outbound.removeFirstOrNull()

  // Godot → host
  fun sendMessage(json: String) {
    onMessageToHost?.invoke(json)
  }
}
