package expo.modules.godotview

/**
 * The host-side message queue between React Native and the Godot engine — Android counterpart of
 * `ios/GodotBridge.swift`.
 *
 * Two directions, deliberately asymmetric because the engine polls rather than being pushed to:
 *   host → Godot: RN calls ExpoGodotViewModule.sendMessageToGodot → addMessage() enqueues, and
 *                 MobileComm.gd drains via pendingMessagesCount()/getMessage() on the GL thread.
 *   Godot → host: AndroidGodotInterface.sendMessage() → onMessageToHost → the onGodotMessage
 *                 RN event.
 *
 * Both directions cross threads (RN's JS thread vs the engine's GL thread), so the queue is
 * synchronized. It is an object rather than an instance because the engine singleton is created
 * by the plugin registry, which we do not control the lifetime of.
 */
object GodotBridge {
  /** Set by the module to forward Godot → host messages to JS as `onGodotMessage`. */
  var onMessageToHost: ((String) -> Unit)? = null

  private val outbound = ArrayDeque<String>()

  /** host → Godot (called from JS via sendMessageToGodot). */
  @Synchronized
  fun addMessage(json: String) {
    outbound.addLast(json)
  }

  /** Called by AndroidGodotInterface on the engine thread. */
  @Synchronized
  fun pendingMessagesCount(): Int = outbound.size

  @Synchronized
  fun getMessage(): String? = outbound.removeFirstOrNull()

  /** Godot → host. */
  fun sendMessage(json: String) {
    onMessageToHost?.invoke(json)
  }

  /** Drop anything queued for an engine that is going away. */
  @Synchronized
  fun clear() {
    outbound.clear()
  }
}
