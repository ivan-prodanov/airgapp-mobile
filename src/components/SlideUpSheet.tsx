import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Bottom-up sheet transition copied from the Tesla app's `forBottomUp` cardStyleInterpolator
// (v4.58.0 bundle). Both halves are driven by the SAME progress value, which is the point:
//
//   cardStyle:    translateY: progress → [screen.height, 0]
//   overlayStyle: opacity:    progress → [0, 0.5]   (extrapolate: 'clamp')
//
// so the backdrop dims *as* the panel travels, rather than a static scrim popping in behind it. The
// overlay colour is react-navigation's Card default (`{ flex: 1, backgroundColor: '#000' }`), i.e. pure
// black at 50% max — not a pre-baked rgba. Tesla translates the whole full-screen (transparent) card, so
// we do the same: the panel is anchored to the bottom of a full-screen container that slides as one.
const OPEN_MS = 300;
const CLOSE_MS = 250;
export const SHEET_DIM_MAX = 0.5;

export function SlideUpSheet({
  visible,
  onDismiss,
  panelStyle,
  children,
}: {
  visible: boolean;
  // Tap anywhere above the panel (the app calls this `onBackgroundPress`) — cancels the operation.
  onDismiss: () => void;
  panelStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  // Stay mounted through the close animation, then unmount.
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [visible, progress, height]);

  if (!rendered) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SHEET_DIM_MAX],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.card, { transform: [{ translateY }] }]}>
        <Pressable style={styles.above} onPress={onDismiss} />
        <View style={[styles.panel, panelStyle]}>{children}</View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: '#000',
  },
  card: {
    justifyContent: 'flex-end',
  },
  above: {
    flex: 1,
  },
  panel: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
});
