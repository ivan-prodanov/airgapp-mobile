import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoGodotViewProps } from './ExpoGodotView.types';

const NativeView: React.ComponentType<ExpoGodotViewProps> = requireNativeView('ExpoGodotView');

export default function ExpoGodotView(props: ExpoGodotViewProps) {
  return <NativeView {...props} />;
}
