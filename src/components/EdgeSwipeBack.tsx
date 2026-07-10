import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

// A left-edge swipe-back strip (the standard iOS "swipe from the very left edge to go back"). We render our
// own instead of relying on the native Stack gesture because, since iOS 26, react-native-screens routes
// swipe-back through the native `interactiveContentPopGestureRecognizer`, which responds to the WHOLE screen
// rather than just the edge — so a horizontal drag anywhere (e.g. the Charging charge-limit slider) pops the
// screen. Screens using this set `gestureEnabled: false` on their Stack.Screen to disable that full-screen
// gesture, and this strip restores the edge-only one. Mirrors the edge-back PanResponder in index.tsx.
export function EdgeSwipeBack({ onBack }: { onBack: () => void }) {
  const cb = useRef(onBack);
  cb.current = onBack;
  const pan = useRef(
    PanResponder.create({
      // Claim only clear rightward drags; vertical drags fall through (sheet resize / scroll keep working).
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && g.dx > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_e, g) => {
        // Defer a frame: router.back() unmounts THIS strip; doing it during its own release frees the active
        // responder and crashes RN's touch handler (same reason as index.tsx's edge-back).
        if (g.dx > 70 || g.vx > 0.4) requestAnimationFrame(() => cb.current());
      },
    }),
  ).current;
  return <View style={styles.strip} {...pan.panHandlers} />;
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 26,
    zIndex: 50,
  },
});
