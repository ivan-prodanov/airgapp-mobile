import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Device from 'expo-device';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { teslaStatusBarHeight } from '@/godot/teslaStatusBarHeight';

// The dark band across the top of Climate.
//
// Source: docs/superpowers/research/tesla-climate-sheet-slide-FINDINGS.md §2 —
// it is their `StatusBarFade` (module 8567, fn #96623), VERBATIM:
//
//   function StatusBarFade({colors, start, end, style}) {
//     const theme = useContext(ThemeContext);
//     if (colors == null) colors = [theme.v5BackgroundColor, theme.v5BackgroundColorTransparent];
//     return <>{Platform.OS === 'ios' &&      // iOS-ONLY: Android renders nothing
//       <Animated.View style={[styles.statusBarContainer, style]}>
//         <LinearGradient style={styles.statusBarFade} colors={colors}
//                         start={{x:0, y: start ?? 0}} end={{x:0, y: end ?? 1}}/>
//       </Animated.View>}</>;
//   }
//   statusBarContainer = { height: Specifications.statusBarHeight, left: 0, right: 0, top: 0, position: 'absolute' };
//   statusBarFade      = { height: '100%', width: '100%' };
//
// Notes that matter:
//  - Its height is literally `Specifications.statusBarHeight` — the same
//    hardcoded device table R9 recovered (59 on our iPhone18,4), NOT the real
//    safe-area inset. Same trap as the renderer frames.
//  - Climate renders it with NO PROPS, so `start.y = 0` and no opacity override
//    ⇒ permanently on at full strength. (Home passes `start={0.7}` + an animated
//    opacity, so its band is scroll-driven and usually invisible; Controls never
//    imports it at all — which is a good way to sanity-check this on device.)
//  - It is FIXED CHROME: its only inputs are the theme background and the device
//    id. It reads no VIN, no paint, no vehicle config — the user's guess that it
//    is "very likely unrelated to the car" was right. It's a status-bar
//    legibility scrim.
//  - The Climate module's OTHER gradient (`headerGradient`, 300pt, #000000 ->
//    transparent) is CYBERTRUCK-THEME ONLY and a Model Y never renders it. A
//    red herring the RE chased and killed.
const BG = '#161718'; // theme.v5BackgroundColor (dark)
const BG_TRANSPARENT = '#16171800'; // theme.v5BackgroundColorTransparent

export function StatusBarFade() {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  // Their `Specifications.statusBarHeight`, not insets.top — see above. The
  // window is only consulted on the unknown-device fallback path, but it has to
  // be real or that path would misjudge isIPhoneX.
  const height = teslaStatusBarHeight(Device.modelId ?? null, win, insets.top);

  // iOS-only, exactly as theirs is.
  if (Platform.OS !== 'ios') return null;

  return (
    <View style={[styles.container, { height }]} pointerEvents="none">
      <LinearGradient
        style={styles.fade}
        colors={[BG, BG_TRANSPARENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  fade: {
    height: '100%',
    width: '100%',
  },
});
