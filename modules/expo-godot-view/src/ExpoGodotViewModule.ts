import { NativeModule, requireNativeModule } from 'expo';

import type { ExpoGodotViewModuleEvents } from './ExpoGodotView.types';

declare class ExpoGodotViewModule extends NativeModule<ExpoGodotViewModuleEvents> {
  /**
   * Host → Godot. Enqueues a JSON envelope string (`{ "type": ..., "data": ... }`) for the
   * engine to drain. No-op on the iOS simulator — no engine there (see GODOT_INTEGRATION.md).
   */
  sendMessageToGodot(message: string): void;
}

export default requireNativeModule<ExpoGodotViewModule>('ExpoGodotView');
