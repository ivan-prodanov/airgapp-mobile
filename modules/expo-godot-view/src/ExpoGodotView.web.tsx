import { ExpoGodotViewProps } from './ExpoGodotView.types';

// ExpoGodotView is not available on the web platform.
export default function ExpoGodotView(_props: ExpoGodotViewProps) {
  throw new Error('ExpoGodotView is not available on the web platform.');
}
