import { NativeModule, requireNativeModule } from 'expo';

declare class ExpoGodotViewModule extends NativeModule<{}> {
  hello(): string;
}

export default requireNativeModule<ExpoGodotViewModule>('ExpoGodotView');
