import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderHandlers,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

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

// Props to spread on the consumer's scroll container so it scrolls only when the sheet is fully expanded and
// reports its offset (for the "at top → swipe down lowers the sheet" hand-off).
export interface SheetScrollProps {
  scrollEnabled: boolean;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
}

interface RenderProps {
  dragHandlers: GestureResponderHandlers; // the top handle strip
  expandFull: () => void;
  collapseToMiddle: () => void;
  // Spread on a View wrapping the scroll container: drags resize the sheet (not-full) or lower it (full+top).
  contentPanHandlers: GestureResponderHandlers;
  // Spread on the scroll container itself (ScrollView/FlatList). See SheetScrollProps.
  scrollProps: SheetScrollProps;
  // Latch OFF the content pan while an internal drag (e.g. a row reorder) owns the gesture.
  setContentBusy: (busy: boolean) => void;
}
interface Props {
  children: (props: RenderProps) => ReactNode;
  // 'middle' locks the sheet so it can't be dragged below the middle detent (used by the Trip sheet, which
  // keeps its pinned action buttons in view). Default 'minimal' = the full three-detent range.
  lowestDetent?: 'minimal' | 'middle';
  // Override the middle detent's visible screen fraction. The Trip sheet uses a taller ~half-screen detent.
  middleFrac?: number;
}

const OVERDRAG_RESIST = 2.5;
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  if (y > collapsed) return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  return y;
};

// Bottom-anchored panel dragged by its top handle between three detents (full / middle / minimal), shared by
// LocationSheet (search/charging) and TripSheet (itinerary). The body coordinates scroll-vs-resize: not fully
// expanded → a body drag resizes the sheet; fully expanded → the list scrolls, and a downward drag at the top
// lowers the sheet.
export const BottomSheet = forwardRef<BottomSheetHandle, Props>(function BottomSheet(
  { children, lowestDetent = 'minimal', middleFrac = SHEET_MIDDLE_FRAC },
  ref,
) {
  const { height } = useWindowDimensions();
  const SHEET_H = Math.round(height * SHEET_FULL_FRAC);
  const snaps = useMemo(() => {
    const full = 0;
    const middle = Math.round(SHEET_H - height * middleFrac);
    const minimal = Math.round(SHEET_H - height * SHEET_MINIMAL_FRAC);
    const points = lowestDetent === 'middle' ? [full, middle] : [full, middle, minimal];
    return { full, middle, minimal, points, collapsed: points[points.length - 1] };
  }, [SHEET_H, height, lowestDetent, middleFrac]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

  const translateY = useRef(new Animated.Value(snaps.middle)).current;
  const restingY = useRef(snaps.middle);
  const scrollOffset = useRef(0); // current scroll position of the body list (plain-ScrollView sheets)
  const contentBusy = useRef(false); // an internal drag (reorder) owns the gesture → the sheet pan yields
  const [atFull, setAtFull] = useState(false); // reactive: drives scrollEnabled on the body

  const settle = useCallback(
    (target: number, velocityY = 0) => {
      restingY.current = target;
      setAtFull(target === snapsRef.current.full);
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

  const onMove = useCallback(
    (dy: number) => {
      const s = snapsRef.current;
      translateY.setValue(overDrag(restingY.current + dy, s.full, s.collapsed));
    },
    [translateY],
  );
  const onRelease = useCallback(
    (dy: number, vy: number) => {
      const s = snapsRef.current;
      const projected = restingY.current + dy + vy * 200;
      const target = s.points.reduce(
        (best, p) => (Math.abs(p - projected) < Math.abs(best - projected) ? p : best),
        s.points[0],
      );
      settle(target, vy);
    },
    [settle],
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

  // The top handle strip: always resizes the sheet.
  const handlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => onMove(g.dy),
      onPanResponderRelease: (_e, g) => onRelease(g.dy, g.vy),
    }),
  ).current;

  // The body: resizes the sheet when not fully expanded; when fully expanded, only a downward drag at the top
  // of the list is captured (to lower the sheet) — everything else falls through to the scroll container.
  const contentPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (contentBusy.current) return false; // a reorder drag owns the gesture
        if (Math.abs(g.dy) <= Math.abs(g.dx)) return false; // horizontal → row swipe / let through
        if (restingY.current !== snapsRef.current.full) return Math.abs(g.dy) > 6; // not full → resize
        return g.dy > 6 && scrollOffset.current <= 0; // full → down at the top → lower
      },
      onPanResponderMove: (_e, g) => onMove(g.dy),
      onPanResponderRelease: (_e, g) => onRelease(g.dy, g.vy),
    }),
  ).current;

  const setContentBusy = useCallback((busy: boolean) => {
    contentBusy.current = busy;
  }, []);

  const renderProps: RenderProps = {
    dragHandlers: handlePan.panHandlers,
    expandFull: () => settle(snapsRef.current.full),
    collapseToMiddle: () => settle(snapsRef.current.middle),
    contentPanHandlers: contentPan.panHandlers,
    scrollProps: {
      scrollEnabled: atFull,
      onScroll: (e) => {
        scrollOffset.current = e.nativeEvent.contentOffset.y;
      },
      scrollEventThrottle: 16,
    },
    setContentBusy,
  };

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]}>
      <View style={styles.handleWrap} {...handlePan.panHandlers}>
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
