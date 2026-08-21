import type { GestureResponderHandlers } from 'react-native';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet, SHEET_TALL_FRAC, type SheetScrollProps } from './BottomSheet';
import type { LatLng } from '@/state/mockLocation';
import { AppIcon } from '../icons/AppIcon';
import type { TeslaIconName } from '../icons/TeslaIcon';

// A point previewed on the map: either long-pressed (we render our own pin) or a tapped Apple map feature
// (Apple already highlights its own marker, so we render none). Rich fields come from the tapped feature
// (category + colour are synchronous; address/phone/website arrive a beat later via MKMapItemRequest).
export interface DroppedPin {
  coordinate: LatLng;
  name: string;
  subtitle: string;
  fromPoi: boolean; // tapped an Apple map feature → don't draw our own marker
  category?: string; // e.g. "Restaurant", "Airport"
  address?: string;
  phone?: string;
  url?: string;
  color?: string; // Apple's icon background colour (hex)
}

// Preview panel for a long-pressed point or a tapped POI. Structured like the charger detail: no fixed header
// (the title is the top of the scroll content, wired into the sheet's drag/scroll coordination), and the
// single primary action (Send to Car) is a blue button pinned at the screen bottom by the map screen.
export function PlacePreviewSheet({ pin, onClose }: { pin: DroppedPin; onClose: () => void }) {
  const insetBottom = useSafeAreaInsets().bottom;
  const accent = pin.color || '#E5484D';
  const address = pin.address ?? pin.subtitle;
  return (
    <BottomSheet lowestDetent="middle" middleFrac={SHEET_TALL_FRAC}>
      {({ contentPanHandlers, scrollProps }) => (
        <View style={styles.content}>
          <Body
            pin={pin}
            accent={accent}
            address={address}
            onClose={onClose}
            insetBottom={insetBottom}
            contentPanHandlers={contentPanHandlers}
            scrollProps={scrollProps}
          />
        </View>
      )}
    </BottomSheet>
  );
}

function Body({
  pin,
  accent,
  address,
  onClose,
  insetBottom,
  contentPanHandlers,
  scrollProps,
}: {
  pin: DroppedPin;
  accent: string;
  address: string;
  onClose: () => void;
  insetBottom: number;
  contentPanHandlers: GestureResponderHandlers;
  scrollProps: SheetScrollProps;
}) {
  return (
    <View style={styles.scrollList} {...contentPanHandlers}>
      <ScrollView
        {...scrollProps}
        style={styles.scrollList}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: insetBottom + 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.block}>
          <View style={styles.topRow}>
            <View style={styles.networkRow}>
              <AppIcon icon="pin-filled" color={accent} size={16} />
              <Text style={styles.network} numberOfLines={1}>
                {pin.category ?? 'Location'}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={onClose}>
              <AppIcon icon="x-circle-filled" color="rgba(235,235,245,0.45)" size={26} />
            </Pressable>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {pin.name}
          </Text>
        </View>

        {address || pin.phone || pin.url ? (
          <>
            <View style={styles.divider} />
            <View style={styles.block}>
              {address ? <InfoRow icon="pin-filled" text={address} /> : null}
              {pin.phone ? (
                <InfoRow icon="phone-filled" text={pin.phone} onPress={() => Linking.openURL(`tel:${pin.phone}`)} />
              ) : null}
              {pin.url ? (
                <InfoRow
                  icon="globe"
                  text="Website"
                  onPress={() => {
                    if (pin.url) Linking.openURL(pin.url);
                  }}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, text, onPress }: { icon: TeslaIconName; text: string; onPress?: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.infoRow, { opacity: pressed && onPress ? 0.6 : 1 }]} onPress={onPress} disabled={!onPress}>
      <AppIcon icon={icon} color="rgba(255,255,255,0.55)" size={17} />
      <Text style={[styles.infoText, onPress ? styles.infoLink : null]} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  scrollList: { flex: 1 },
  block: { paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, marginRight: 12 },
  network: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  title: { fontSize: 27, fontWeight: '700', color: 'white' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 18,
    marginHorizontal: 20,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  infoText: { flex: 1, fontSize: 16, color: 'white' },
  infoLink: { color: '#3E6AE1' },
});
