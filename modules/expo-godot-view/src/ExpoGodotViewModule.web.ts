import { registerWebModule, NativeModule } from 'expo';

// ExpoGodotViewModule is not available on the web platform.
class ExpoGodotViewModule extends NativeModule<{}> {}

export default registerWebModule(ExpoGodotViewModule, 'ExpoGodotViewModule');
