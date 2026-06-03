import { registerWebModule, NativeModule } from 'expo';

import type { ExpoGodotViewModuleEvents } from './ExpoGodotView.types';

class ExpoGodotViewModule extends NativeModule<ExpoGodotViewModuleEvents> {
  sendMessageToGodot(_message: string): void {
    // No Godot engine on web. No-op stub.
  }
}

export default registerWebModule(ExpoGodotViewModule, 'ExpoGodotViewModule');
