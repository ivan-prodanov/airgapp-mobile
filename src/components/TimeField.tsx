import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutRectangle,
} from 'react-native';

// A rounded pill that opens a COMPACT floating wheel anchored to it, matching the
// Tesla app: two columns (hours / 15-minute minutes), a centre highlight bar,
// top/bottom fade, no Cancel/Done — it commits live as you scroll and dismisses
// on tap-away. (Our old version was the full-width native bottom sheet with
// Cancel/Done and 1-minute steps — nothing like theirs.)
const pad2 = (n: number) => n.toString().padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = ['00', '15', '30', '45']; // Tesla steps minutes by 15.

const ROW_H = 40;
const VISIBLE = 5; // 2 above · centre · 2 below
const PAD_ROWS = (VISIBLE - 1) / 2;
const CARD_W = 220;
const CARD_BG = 'rgba(58,58,60,0.97)';

const nearest15 = (m: number) => pad2((Math.round(m / 15) * 15) % 60);

function Wheel({
  items,
  value,
  onChange,
  align,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  align: 'right' | 'left';
}) {
  const ref = useRef<ScrollView>(null);
  const idx = Math.max(0, items.indexOf(value));
  return (
    <ScrollView
      ref={ref}
      showsVerticalScrollIndicator={false}
      snapToInterval={ROW_H}
      decelerationRate="fast"
      // Seed the wheel to the current value once it has laid out.
      onLayout={() => ref.current?.scrollTo({ y: idx * ROW_H, animated: false })}
      onMomentumScrollEnd={(e) => {
        const i = Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ROW_H)));
        onChange(items[i]);
      }}
      contentContainerStyle={{ paddingVertical: ROW_H * PAD_ROWS }}
      style={{ height: ROW_H * VISIBLE, width: 64 }}
    >
      {items.map((it) => (
        <View key={it} style={styles.rowItem}>
          <Text style={[styles.item, it === value ? styles.itemSel : styles.itemDim, { textAlign: align }]}>
            {it}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<LayoutRectangle | null>(null);
  const pillRef = useRef<View>(null);

  const [h, setH] = useState('08');
  const [m, setM] = useState('00');

  const openPicker = () => {
    const [hh, mm] = value.split(':');
    setH(pad2(parseInt(hh, 10) || 0));
    setM(nearest15(parseInt(mm, 10) || 0));
    pillRef.current?.measureInWindow((x, y, w, ht) => {
      setAnchor({ x, y, width: w, height: ht });
      setOpen(true);
    });
  };

  // Commit live — every column settle writes H:M straight back.
  const commit = (nh: string, nm: string) => {
    setH(nh);
    setM(nm);
    onChange(`${nh}:${nm}`);
  };

  const cardLeft = anchor
    ? Math.min(Math.max(anchor.x + anchor.width - CARD_W, 12), screenW - CARD_W - 12)
    : 12;
  const cardTop = anchor ? anchor.y + anchor.height + 6 : 120;

  return (
    <>
      <Pressable
        ref={pillRef}
        style={[styles.pill, disabled && styles.pillDisabled]}
        disabled={disabled}
        onPress={openPicker}
      >
        <Text style={styles.pillText}>{value}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.card, { top: cardTop, left: cardLeft }]}>
          <View style={styles.wheels}>
            <Wheel items={HOURS} value={h} onChange={(nh) => commit(nh, m)} align="right" />
            <View style={styles.colon} />
            <Wheel items={MINUTES} value={m} onChange={(nm) => commit(h, nm)} align="left" />
          </View>
          {/* Centre selection bar + top/bottom fade, both non-interactive. */}
          <View style={styles.highlight} pointerEvents="none" />
          <LinearGradient
            colors={[CARD_BG, 'rgba(58,58,60,0)']}
            style={[styles.fade, { top: 0 }]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['rgba(58,58,60,0)', CARD_BG]}
            style={[styles.fade, { bottom: 0 }]}
            pointerEvents="none"
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 5,
    backgroundColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    fontVariant: ['tabular-nums'],
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: ROW_H * VISIBLE,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    overflow: 'hidden',
    // A soft lift off the sheet, like the floating popover Tesla draws.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colon: {
    width: 22,
  },
  rowItem: {
    height: ROW_H,
    justifyContent: 'center',
  },
  item: {
    fontSize: 24,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    width: 64,
  },
  itemSel: {
    color: 'white',
  },
  itemDim: {
    color: 'rgba(255,255,255,0.35)',
  },
  highlight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: ROW_H * PAD_ROWS,
    height: ROW_H,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_H * PAD_ROWS,
  },
});
