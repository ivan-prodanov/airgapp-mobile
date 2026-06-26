import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { CONTROL_ACTIONS, CONTROL_ACTION_ORDER, type ControlActionId } from '@/state/controlActions';
import { SpinningSymbol } from '@/components/SpinningSymbol';
import { usePreferences, useVehicle } from '@/state/VehicleProvider';

const TILE = 72; // ghost square size

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Tesla "Customize Controls" sheet. Rises over a dimmed Home; the top row mirrors the 5 favorite
// slots (drop targets), and the grid below holds every other action. Drag a grid tile onto a slot to
// replace it. Drag the grab-handle down (or tap the backdrop) to dismiss. PanResponder throughout —
// RNGH is inert in this app's native tabs.
export function CustomizeControlsSheet({ visible, onClose }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [state] = useVehicle();
  const { favorites, setFavorite } = usePreferences();

  // Grid = catalog order minus the current favorites → always 11 items.
  const gridItems = CONTROL_ACTION_ORDER.filter((id) => !favorites.includes(id));

  // Keep the sheet mounted through the close animation, then unmount.
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(height)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const setFavoriteRef = useRef(setFavorite);
  setFavoriteRef.current = setFavorite;

  const open = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 14 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdropOpacity]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      requestAnimationFrame(open);
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: height, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, height]);

  // --- drag the grab handle down to dismiss ---
  const handlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.6) {
          onCloseRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 14 }).start();
        }
      },
    }),
  ).current;

  // --- drag-and-drop state ---
  const ghost = useRef(new Animated.ValueXY()).current;
  const ghostScale = useRef(new Animated.Value(0)).current;
  const [dragId, setDragId] = useState<ControlActionId | null>(null);
  const [hoverSlot, setHoverSlot] = useState(-1);

  // Slot frames in WINDOW coordinates (so PanResponder's moveX/moveY compare directly). The root view
  // is full-screen at (0,0), so window coords == this component's local coords for the ghost overlay.
  const slotFrames = useRef<LayoutRectangle[]>([]);
  const slotRefs = useRef<(View | null)[]>([]);
  const dragRef = useRef<{ id: ControlActionId | null; hoverSlot: number }>({ id: null, hoverSlot: -1 });

  const measureSlot = useCallback((i: number) => {
    const node = slotRefs.current[i];
    if (node) {
      node.measureInWindow((x, y, width, h) => {
        slotFrames.current[i] = { x, y, width, height: h };
      });
    }
  }, []);

  const hitSlot = useCallback((x: number, y: number) => {
    const frames = slotFrames.current;
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      if (f && x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) {
        return i;
      }
    }
    return -1;
  }, []);

  const endDrag = useCallback(() => {
    Animated.timing(ghostScale, { toValue: 0, duration: 120, useNativeDriver: false }).start(() => {
      setDragId(null);
      setHoverSlot(-1);
      dragRef.current = { id: null, hoverSlot: -1 };
    });
  }, [ghostScale]);

  // One PanResponder per action id, built once (closures read live values via refs).
  const tilePans = useMemo(() => {
    const map = {} as Record<ControlActionId, ReturnType<typeof PanResponder.create>>;
    for (const id of CONTROL_ACTION_ORDER) {
      map[id] = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderGrant: (e) => {
          for (let i = 0; i < slotRefs.current.length; i += 1) {
            measureSlot(i);
          }
          const { pageX, pageY } = e.nativeEvent;
          ghost.setValue({ x: pageX - TILE / 2, y: pageY - TILE / 2 });
          dragRef.current = { id, hoverSlot: -1 };
          setDragId(id);
          setHoverSlot(-1);
          Animated.spring(ghostScale, { toValue: 1, useNativeDriver: false, friction: 6 }).start();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          ghost.setValue({ x: g.moveX - TILE / 2, y: g.moveY - TILE / 2 });
          const slot = hitSlot(g.moveX, g.moveY);
          if (slot !== dragRef.current.hoverSlot) {
            dragRef.current.hoverSlot = slot;
            setHoverSlot(slot);
            if (slot !== -1) {
              Haptics.selectionAsync().catch(() => {});
            }
          }
        },
        onPanResponderRelease: (_e, g) => {
          const slot = hitSlot(g.moveX, g.moveY);
          const draggedId = dragRef.current.id;
          if (slot !== -1 && draggedId) {
            setFavoriteRef.current(slot, draggedId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          endDrag();
        },
        onPanResponderTerminate: () => endDrag(),
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
      >
        <View style={styles.handleWrap} {...handlePan.panHandlers}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>Customize Controls</Text>
        <Text style={styles.subtitle}>Drag to replace</Text>

        <View style={styles.slotsRow}>
          {favorites.map((id, i) => {
            const action = CONTROL_ACTIONS[id];
            return (
              <View
                key={id}
                ref={(n) => {
                  slotRefs.current[i] = n;
                }}
                onLayout={() => measureSlot(i)}
                style={[styles.slot, hoverSlot === i && styles.slotHover]}
              >
                <SpinningSymbol
                  name={action.symbol(state)}
                  tintColor={action.isActive(state) ? 'white' : 'rgba(255,255,255,0.55)'}
                  size={28}
                  spin={action.spinning?.(state) ?? false}
                />
              </View>
            );
          })}
        </View>

        <Text style={styles.dragLabel}>
          {dragId ? (CONTROL_ACTIONS[dragId].gridLabel?.(state) ?? CONTROL_ACTIONS[dragId].label) : ' '}
        </Text>

        <View style={styles.divider} />

        <View style={styles.grid}>
          {gridItems.map((id) => {
            const action = CONTROL_ACTIONS[id];
            const dragging = dragId === id;
            return (
              <View key={id} style={styles.tile} {...tilePans[id].panHandlers}>
                <View style={dragging ? styles.tileIconHidden : undefined}>
                  <SpinningSymbol
                    name={action.symbol(state)}
                    tintColor="rgba(255,255,255,0.92)"
                    size={26}
                    spin={action.spinning?.(state) ?? false}
                  />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {action.gridLabel ? action.gridLabel(state) : action.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Animated.View>

      {dragId ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghost,
            {
              transform: [
                { translateX: ghost.x },
                { translateY: ghost.y },
                { scale: ghostScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) },
              ],
            },
          ]}
        >
          <SymbolView name={CONTROL_ACTIONS[dragId].symbol(state)} tintColor="white" size={32} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
  },
  handleWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 2,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
  },
  slot: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotHover: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  dragLabel: {
    height: 18,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 8,
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tile: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  tileIconHidden: {
    opacity: 0,
  },
  tileLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 2,
  },
  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TILE,
    height: TILE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
