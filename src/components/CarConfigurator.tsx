import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { TeslaFonts } from '@/constants/fonts';
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

export interface CarConfiguratorOptions {
  name: string;
  exteriorColor: string;
  wheelType: string;
  interiorTrim: string;
  performance: boolean;
}

// The car-appearance configurator (model / body / seats / trim / color / wheels /
// interior / name). Extracted from CarsSheet's "Add Car" view so the demo Add-Car
// flow and the onboarding pair wizard share one form.
//
// `lockedBase` pins the Model line (the pair flow derives it from the VIN, so the
// user must not be able to pick a different car than the one they are pairing).
// It is read ONCE for the initial field defaults — key the component by VIN if the
// locked line can change while it stays mounted.
export function CarConfigurator({
  contentMaxHeight,
  lockedBase,
  initialBase,
  submitLabel,
  title = 'Add Car',
  onBack,
  onSubmit,
}: {
  contentMaxHeight: number;
  lockedBase?: BaseModel;
  initialBase?: BaseModel;
  submitLabel?: string;
  title?: string;
  onBack: () => void;
  onSubmit: (model: CarModel, opts: CarConfiguratorOptions) => void;
}) {
  const startBase: BaseModel = lockedBase ?? initialBase ?? 'modelY';
  const [base, setBase] = useState<BaseModel>(startBase);
  const [body, setBody] = useState<BodyGen>('new');
  const [seats, setSeats] = useState<SeatCount>(5);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => defaultColorFor(startBase, 'new'));
  const [trim, setTrim] = useState<string>(() => defaultTrimFor(startBase).value);
  const [wheel, setWheel] = useState<string>(() => defaultWheelFor(startBase, 'new'));
  const [interior, setInterior] = useState<string>(() => defaultInteriorFor(startBase));

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
        <Text style={styles.title}>{title}</Text>
      </View>

      <ScrollView
        style={{ maxHeight: contentMaxHeight }}
        keyboardShouldPersistTaps="handled"
        // The Name field is the last item; without this the keyboard covers it (fixed maxHeight, no
        // keyboard avoidance). automaticallyAdjustKeyboardInsets insets for the keyboard and scrolls
        // the focused input above it; on-drag lets a downward swipe dismiss the keyboard.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}>
        <Text style={styles.fieldLabel}>Model</Text>
        {lockedBase ? (
          <>
            {/* Locked: no onChange, so the segments are inert (and silent). */}
            <Segmented options={BASE_MODELS.map((m) => ({ value: m.value, label: m.label }))} value={base} />
            <Text style={styles.lockedHint}>Detected from your VIN</Text>
          </>
        ) : (
          <Segmented
            options={BASE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
            value={base}
            onChange={pickModel}
          />
        )}

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
          onSubmit(model, {
            name: name.trim(),
            exteriorColor: color,
            wheelType: wheel,
            interiorTrim: interior,
            performance,
          })
        }>
        <Text style={styles.addButtonText}>{submitLabel ?? 'Add'}</Text>
      </Pressable>
    </>
  );
}

// A small pill segmented control. Generic over the option value so it drives the
// string/number choices above without casts. Omitting `onChange` makes it a
// read-only display (used for the VIN-locked Model line).
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange?: (v: T) => void;
}) {
  return (
    <View style={[styles.segmented, !onChange && styles.segmentedLocked]}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
            disabled={!onChange}
            onPress={() => {
              if (!onChange) return;
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
  // Same values as CarsSheet's list header (CarList shares headerRow + title).
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
  // Read-only (locked) state: dimmed so it reads as fixed, not as a choice.
  segmentedLocked: {
    opacity: 0.6,
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
  lockedHint: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 6,
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
});
