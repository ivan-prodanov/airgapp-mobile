import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { CarConfigurator } from '@/components/CarConfigurator';
import { VehicleThumbnail } from '@/components/VehicleThumbnail';
import { confirmRemoveVehicle } from '@/components/confirmRemoveVehicle';
import { TeslaFonts } from '@/constants/fonts';
import type { Vehicle } from '@/state/fleet';
import type { CarModel } from '@/types/vehicleTypes';
import { AppIcon } from '../icons/AppIcon';
import { useAndroidBack } from '@/hooks/useAndroidBack';

interface Props {
  visible: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  activeId: string;
  onSelectVehicle: (id: string) => void;
  onRemoveVehicle: (id: string) => void;
  onAddVehicle: (
    model: CarModel,
    opts?: {
      name?: string;
      exteriorColor?: string;
      wheelType?: string;
      interiorTrim?: string;
      performance?: boolean;
    },
  ) => void;
}

// The "Cars" dropdown from the official app's main menu: tapping the header
// vehicle name drops this panel down from the top over a dimmed Home. It lists
// every car (tap to switch) and offers "Add Car", which flips to an in-sheet
// configurator (model / body / seats / name; color + wheels land in a follow-up).
//
// Same sheet mechanics as CustomizeControlsSheet — Animated + PanResponder, since
// RNGH is inert in this app's native tabs — but anchored at the TOP and dragged
// UP to dismiss.
export function CarsSheet({
  visible,
  onClose,
  vehicles,
  activeId,
  onSelectVehicle,
  onRemoveVehicle,
  onAddVehicle,
}: Props) {
  const { height } = useWindowDimensions();
  // Cap the car list so the card never runs past the screen; beyond that it
  // scrolls. Everything else (title, Add Car, handle) stays pinned.
  const listMaxHeight = Math.round(height * 0.5);
  const [mounted, setMounted] = useState(visible);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const translateY = useRef(new Animated.Value(-24)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Android's system back closes the sheet instead of backgrounding the app — the
  // same gap that made Controls minimise (see useAndroidBack).
  useAndroidBack(visible, () => onCloseRef.current());

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setMode('list');
      translateY.setValue(-24);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 3, speed: 16 }),
          Animated.timing(sheetOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      });
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -24, duration: 180, useNativeDriver: true }),
        Animated.timing(sheetOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag the grab-handle UP to dismiss (this sheet hangs from the top).
  const handlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => translateY.setValue(Math.min(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -110 || g.vy < -0.6) {
          onCloseRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 3, speed: 16 }).start();
        }
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.card, { opacity: sheetOpacity, transform: [{ translateY }] }]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.cardBody}>
            {mode === 'list' ? (
              <CarList
                vehicles={vehicles}
                activeId={activeId}
                listMaxHeight={listMaxHeight}
                onClose={onClose}
                onSelect={(id) => {
                  Haptics.selectionAsync();
                  onSelectVehicle(id);
                  onClose();
                }}
                onRemove={onRemoveVehicle}
                onAdd={() => {
                  Haptics.selectionAsync();
                  setMode('add');
                }}
              />
            ) : (
              <CarConfigurator
                contentMaxHeight={height - 230}
                submitLabel="Add Car"
                onBack={() => setMode('list')}
                onSubmit={(model, opts) => {
                  Haptics.selectionAsync();
                  onAddVehicle(model, {
                    name: opts.name || undefined,
                    exteriorColor: opts.exteriorColor,
                    wheelType: opts.wheelType,
                    interiorTrim: opts.interiorTrim,
                    performance: opts.performance,
                  });
                  onClose();
                }}
              />
            )}
          </View>
        </SafeAreaView>

        {/* grab handle — drag up to dismiss */}
        <View style={styles.handleWrap} {...handlePan.panHandlers}>
          <View style={styles.handle} />
        </View>
      </Animated.View>
    </View>
  );
}

function CarList({
  vehicles,
  activeId,
  listMaxHeight,
  onClose,
  onSelect,
  onRemove,
  onAdd,
}: {
  vehicles: Vehicle[];
  activeId: string;
  listMaxHeight: number;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <Pressable style={styles.headerRow} onPress={onClose}>
        <Text style={styles.title}>Cars</Text>
        <AppIcon icon="chevron-0" color="rgba(255,255,255,0.55)" size={18} />
      </Pressable>

      <ScrollView style={{ maxHeight: listMaxHeight }} showsVerticalScrollIndicator alwaysBounceVertical>
        {vehicles.map((v) => {
          const battery = v.state.batteryLevel != null ? `${Math.round(v.state.batteryLevel)}%` : null;
          return (
            <View key={v.id} style={styles.carRow}>
              <Pressable style={styles.carSelect} onPress={() => onSelect(v.id)}>
                <View style={styles.carText}>
                  <Text style={[styles.carName, v.id === activeId && styles.carNameActive]}>{v.name}</Text>
                  {battery ? <Text style={styles.carBattery}>{battery}</Text> : null}
                </View>
                <VehicleThumbnail state={v.state} imageStyle={styles.carThumb} glyphSize={64} />
              </Pressable>
              <Pressable
                style={styles.carRemove}
                hitSlop={8}
                onPress={() =>
                  confirmRemoveVehicle({ name: v.name, isReal: v.vin != null, onRemove: () => onRemove(v.id) })
                }>
                <AppIcon icon="x-circle-filled" color="rgba(255,255,255,0.35)" size={24} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.divider} />

      <Pressable style={styles.addRow} onPress={onAdd}>
        <AppIcon icon="plus" color="white" size={20} style={styles.addPlus} />
        <Text style={styles.addLabel}>Add Car</Text>
      </Pressable>
    </>
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
    // Dark scrim with a faint blue cast (the "blue behind the rest of the screen").
    backgroundColor: 'rgba(6,10,20,0.62)',
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#161718',
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  cardBody: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontFamily: TeslaFonts.bold,
    fontSize: 28,
    color: 'white',
  },
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  // The tappable select area (name + battery + thumbnail); the X remove control
  // sits outside it on the far right.
  carSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  carRemove: {
    paddingLeft: 16,
    paddingVertical: 6,
  },
  carText: {
    flex: 1,
  },
  // Snapshot thumbnail (≈16:9, matching the 900×500 render) on the row's right.
  carThumb: {
    width: 104,
    height: 58,
  },
  carName: {
    fontFamily: TeslaFonts.medium,
    fontSize: 22,
    color: 'white',
  },
  carNameActive: {
    // The active car reads at full strength; there's no explicit checkmark in the
    // reference, so the list stays quiet.
    color: 'white',
  },
  carBattery: {
    fontFamily: TeslaFonts.medium,
    fontSize: 15,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 10,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  addPlus: {
    width: 28,
    height: 28,
  },
  addLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 20,
    color: 'white',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 10,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
