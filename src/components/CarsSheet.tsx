import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { VehicleThumbnail } from '@/components/VehicleThumbnail';
import { confirmRemoveVehicle } from '@/components/confirmRemoveVehicle';
import { TeslaFonts } from '@/constants/fonts';
import type { Vehicle } from '@/state/fleet';
import type { CarModel } from '@/types/vehicleTypes';
import {
  BASE_MODELS,
  INTERIORS_BY_MODEL,
  TRIMS_BY_MODEL,
  colorsFor,
  wheelsFor,
  defaultColorFor,
  defaultInteriorFor,
  defaultTrimFor,
  defaultWheelFor,
  resolveCarModel,
  seatOptionsFor,
  type BaseModel,
  type BodyGen,
  type SeatCount,
} from '@/state/carConfigurator';
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
              <AddCar
                contentMaxHeight={height - 230}
                onBack={() => setMode('list')}
                onCreate={(model, opts) => {
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

function AddCar({
  contentMaxHeight,
  onBack,
  onCreate,
}: {
  contentMaxHeight: number;
  onBack: () => void;
  onCreate: (
    model: CarModel,
    opts: { name: string; exteriorColor: string; wheelType: string; interiorTrim: string; performance: boolean },
  ) => void;
}) {
  const [base, setBase] = useState<BaseModel>('modelY');
  const [body, setBody] = useState<BodyGen>('new');
  const [seats, setSeats] = useState<SeatCount>(5);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => defaultColorFor('modelY', 'new'));
  const [trim, setTrim] = useState<string>(() => defaultTrimFor('modelY').value);
  const [wheel, setWheel] = useState<string>(() => defaultWheelFor('modelY', 'new'));
  const [interior, setInterior] = useState<string>(() => defaultInteriorFor('modelY'));

  const seatChoices = seatOptionsFor(base, body);
  const trims = TRIMS_BY_MODEL[base];
  const performance = trims.find((t) => t.value === trim)?.performance ?? false;
  // New 3/Y swap their blue by trim (Frost on Performance, Marine otherwise), so
  // the color list depends on `performance`.
  const colors = colorsFor(base, body, performance);
  const defaultName = useMemo(() => BASE_MODELS.find((m) => m.value === base)?.name ?? 'Car', [base]);
  const model = resolveCarModel(base, body, seats);

  // Colors + wheels are per (model × generation), so switching EITHER model or
  // body resets both to the new combination's era-correct defaults (the previous
  // pick may not exist for the new one). Trim + interior are per-model only.
  const pickModel = (v: BaseModel) => {
    setBase(v);
    setColor(defaultColorFor(v, body));
    setWheel(defaultWheelFor(v, body));
    setTrim(defaultTrimFor(v).value);
    setInterior(defaultInteriorFor(v));
    if (v !== 'modelX') setSeats(5);
  };

  const pickBody = (b: BodyGen) => {
    setBody(b);
    setColor(defaultColorFor(base, b));
    setWheel(defaultWheelFor(base, b));
  };

  // Trim drives performance (calipers/spoiler). For new 3/Y it also swaps the blue,
  // so carry a currently-selected blue across the Marine ↔ Frost change.
  const pickTrim = (t: (typeof trims)[number]) => {
    setTrim(t.value);
    if (body === 'new' && (base === 'model3' || base === 'modelY')) {
      if (color === 'MarineBlue' && t.performance) setColor('FrostBlue');
      else if (color === 'FrostBlue' && !t.performance) setColor('MarineBlue');
    }
  };

  return (
    <>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <AppIcon icon="chevron-270" color="rgba(255,255,255,0.7)" size={20} />
        </Pressable>
        <Text style={styles.title}>Add Car</Text>
      </View>

      <ScrollView
        style={{ maxHeight: contentMaxHeight }}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}>
        <Text style={styles.fieldLabel}>Model</Text>
        <Segmented
          options={BASE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
          value={base}
          onChange={pickModel}
        />

        <Text style={styles.fieldLabel}>Body</Text>
        <Segmented
          options={[
            { value: 'new', label: 'New' },
            { value: 'older', label: 'Older' },
          ]}
          value={body}
          onChange={pickBody}
        />

        {seatChoices.length > 0 ? (
          <>
            <Text style={styles.fieldLabel}>Seats</Text>
            <Segmented
              options={seatChoices.map((s) => ({ value: s, label: String(s) }))}
              value={seats}
              onChange={(v) => setSeats(v)}
            />
          </>
        ) : null}

        <Text style={styles.fieldLabel}>Trim</Text>
        <View style={styles.chipRow}>
          {trims.map((t) => {
            const selected = t.value === trim;
            return (
              <Pressable
                key={t.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  pickTrim(t);
                }}
                style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Color</Text>
        <View style={styles.swatchRow}>
          {colors.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => {
                Haptics.selectionAsync();
                setColor(c.value);
              }}
              style={[styles.swatch, { backgroundColor: c.swatch }, color === c.value && styles.swatchSelected]}
            />
          ))}
        </View>
        <Text style={styles.selectedName}>{colors.find((c) => c.value === color)?.label ?? ''}</Text>

        <Text style={styles.fieldLabel}>Wheels</Text>
        <View style={styles.chipRow}>
          {wheelsFor(base, body).map((w) => {
            const selected = w.value === wheel;
            return (
              <Pressable
                key={w.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setWheel(w.value);
                }}
                style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{w.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Interior</Text>
        <View style={styles.swatchRow}>
          {INTERIORS_BY_MODEL[base].map((it) => (
            <Pressable
              key={it.value}
              onPress={() => {
                Haptics.selectionAsync();
                setInterior(it.value);
              }}
              style={[styles.swatch, { backgroundColor: it.swatch }, interior === it.value && styles.swatchSelected]}
            />
          ))}
        </View>
        <Text style={styles.selectedName}>
          {INTERIORS_BY_MODEL[base].find((it) => it.value === interior)?.label ?? ''}
        </Text>

        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder={defaultName}
          placeholderTextColor="rgba(255,255,255,0.35)"
          returnKeyType="done"
          maxLength={40}
        />
      </ScrollView>

      {/* Pinned below the scroll so it's always visible, however tall the form. */}
      <Pressable
        style={styles.addButton}
        onPress={() =>
          onCreate(model, {
            name: name.trim(),
            exteriorColor: color,
            wheelType: wheel,
            interiorTrim: interior,
            performance,
          })
        }>
        <Text style={styles.addButtonText}>Add Car</Text>
      </Pressable>
    </>
  );
}

// A small pill segmented control. Generic over the option value so it drives the
// string/number choices above without casts.
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(opt.value);
            }}>
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{opt.label}</Text>
          </Pressable>
        );
      })}
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
  backBtn: {
    marginLeft: -4,
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
  // --- Add Car configurator ---
  fieldLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 14,
    marginBottom: 8,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  segmentLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
  },
  segmentLabelSelected: {
    color: 'white',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // Constant 2px border (color-only change on select) so nothing reflows.
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  swatchSelected: {
    borderColor: 'white',
  },
  // The selected swatch's name (swatches carry no label, so this is how you read
  // which paint / interior is picked).
  selectedName: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  chipLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  chipLabelSelected: {
    color: 'white',
  },
  nameInput: {
    fontFamily: TeslaFonts.medium,
    fontSize: 16,
    color: 'white',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addButton: {
    backgroundColor: '#3A6FE0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  addButtonText: {
    fontFamily: TeslaFonts.bold,
    fontSize: 16,
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
