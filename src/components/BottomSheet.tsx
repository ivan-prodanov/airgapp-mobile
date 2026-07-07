import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View, type GestureResponderHandlers } from 'react-native';

// Visible fraction of the screen at each detent (measured off the Tesla app's three states). Exported so the
// map can pad its centring/fitting by these panel heights.
export const SHEET_MINIMAL_FRAC = 0.25;
export const SHEET_MIDDLE_FRAC = 0.34;
const SHEET_FULL_FRAC = 0.92;

export interface BottomSheetHandle {
  expand: () => void; // open at least to the middle detent (never shrinks)
  collapse: () => void; // drop to the minimal detent
  expandFull: () => void; // open to the full detent
}

interface RenderProps {
  dragHandlers: GestureResponderHandlers;
  expandFull: () => void;
  collapseToMiddle: () => void;
}
interface Props {
  children: (props: RenderProps) => ReactNode;
  // 'middle' locks the sheet so it can't be dragged below the middle detent (used by the Trip sheet, which
  // keeps its pinned action buttons in view). Default 'minimal' = the full three-detent range.
  lowestDetent?: 'minimal' | 'middle';
}

const OVERDRAG_RESIST = 2.5;
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  if (y > collapsed) return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  return y;
};

// Bottom-anchored panel dragged by its top handle between three detents (full / middle / minimal), shared by
// LocationSheet (search/charging) and TripSheet (itinerary).
export const BottomSheet = forwardRef<BottomSheetHandle, Props>(function BottomSheet({ children, lowestDetent = 'minimal' }, ref) {
  const { height } = useWindowDimensions();
  const SHEET_H = Math.round(height * SHEET_FULL_FRAC);
  const snaps = useMemo(() => {
    const full = 0;
    const middle = Math.round(SHEET_H - height * SHEET_MIDDLE_FRAC);
    const minimal = Math.round(SHEET_H - height * SHEET_MINIMAL_FRAC);
    const points = lowestDetent === 'middle' ? [full, middle] : [full, middle, minimal];
    return { full, middle, minimal, points, collapsed: points[points.length - 1] };
  }, [SHEET_H, height, lowestDetent]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

  const translateY = useRef(new Animated.Value(snaps.middle)).current;
  const restingY = useRef(snaps.middle);

  const settle = useCallback(
    (target: number, velocityY = 0) => {
      restingY.current = target;
      Animated.spring(translateY, {
        toValue: target,
        velocity: velocityY * 500,
        stiffness: 1000,
        damping: 500,
        mass: 3,
        overshootClamping: true,
        restDisplacementThreshold: 0.5,
        restSpeedThreshold: 0.5,
        useNativeDriver: true,
      }).start();
    },
    [translateY],
  );

  useImperativeHandle(
    ref,
    () => ({
      expand: () => settle(Math.min(restingY.current, snapsRef.current.middle)),
      collapse: () => settle(snapsRef.current.collapsed),
      expandFull: () => settle(snapsRef.current.full),
    }),
    [settle],
  );

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const s = snapsRef.current;
        translateY.setValue(overDrag(restingY.current + g.dy, s.full, s.collapsed));
      },
      onPanResponderRelease: (_e, g) => {
        const s = snapsRef.current;
        const projected = restingY.current + g.dy + g.vy * 200;
        const target = s.points.reduce(
          (best, p) => (Math.abs(p - projected) < Math.abs(best - projected) ? p : best),
          s.points[0],
        );
        settle(target, g.vy);
      },
    }),
  ).current;

  const renderProps: RenderProps = {
    dragHandlers: pan.panHandlers,
    expandFull: () => settle(snapsRef.current.full),
    collapseToMiddle: () => settle(snapsRef.current.middle),
  };

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]}>
      <View style={styles.handleWrap} {...pan.panHandlers}>
        <View style={styles.handle} />
      </View>
      {children(renderProps)}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#161616',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  handleWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
});
