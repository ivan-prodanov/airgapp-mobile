import * as React from 'react';
import { Text, View } from 'react-native';

import { ExpoGodotViewProps } from './ExpoGodotView.types';

// No Godot engine on web — render a neutral placeholder so web dev builds run.
export default function ExpoGodotView({ sceneName, style }: ExpoGodotViewProps) {
  return (
    <View style={[{ alignItems: 'center', backgroundColor: '#808080', justifyContent: 'center' }, style]}>
      <Text style={{ color: 'white' }}>Godot view — web stub{sceneName ? ` (scene: ${sceneName})` : ''}</Text>
    </View>
  );
}
