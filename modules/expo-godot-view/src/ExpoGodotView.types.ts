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
  style?: StyleProp<ViewStyle>;
};
