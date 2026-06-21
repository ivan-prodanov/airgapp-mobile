import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Payload for the module-level `onGodotMessage` event.
 *
 * `message` is a JSON envelope string emitted by the Godot engine (`MobileComm.gd`):
 * `{ "type": ..., "data": ... }`. The native layer ferries it verbatim — parsing happens in
 * the TS `GodotRendererBridge` (Phase 3).
 */
export type GodotMessageEventPayload = {
  message: string;
};

export type ExpoGodotViewModuleEvents = {
  onGodotMessage(payload: GodotMessageEventPayload): void;
};

export type ExpoGodotViewProps = {
  /** Scene to display in the single shared Godot instance (e.g. "mobile"). */
  sceneName?: string;
  /**
   * Enable drag-to-orbit on this view. Default false. When true, the native side attaches a
   * UIPanGestureRecognizer to the parent view and feeds drag deltas into Godot's Input system,
   * which the injected GDScript handler in MainViewContainer.gd consumes to rotate the camera.
   * Off elsewhere because the underlying Godot 3.2 ↔ iOS 26 GLES2 driver crashes on touches —
   * see the "Swipe-on-Godot-view crash" section in the project memory.
   */
  orbitEnabled?: boolean;
  style?: StyleProp<ViewStyle>;
};
