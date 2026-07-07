import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { TripRowAction } from './TripSheet';

const ITEMS: { action: TripRowAction; label: string; icon: SFSymbol; destructive?: boolean }[] = [
  { action: 'copy', label: 'Copy', icon: 'doc.on.doc' },
  { action: 'share', label: 'Share', icon: 'square.and.arrow.up' },
  { action: 'insert', label: 'Insert Stop', icon: 'plus' },
  { action: 'delete', label: 'Delete', icon: 'trash', destructive: true },
];

// A native-styled long-press menu: a dark scrim + a card anchored near the pressed row.
export function TripRowMenu({
  visible,
  anchorY,
  title,
  allowDelete = true,
  onAction,
  onClose,
}: {
  visible: boolean;
  anchorY: number;
  title: string;
  allowDelete?: boolean; // false for the car row (per iOS HIG, we omit inapplicable actions rather than disable)
  onAction: (a: TripRowAction) => void;
  onClose: () => void;
}) {
  const items = allowDelete ? ITEMS : ITEMS.filter((it) => it.action !== 'delete');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <View style={[styles.card, { top: Math.max(90, Math.min(anchorY, 560)) }]}>
          <Text style={styles.header} numberOfLines={1}>
            {title}
          </Text>
          {items.map((it) => (
            <Pressable
              key={it.action}
              style={({ pressed }) => [styles.item, { backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent' }]}
              onPress={() => {
                onAction(it.action);
                onClose();
              }}
            >
              <Text style={[styles.itemText, it.destructive && styles.destructive]}>{it.label}</Text>
              <SymbolView name={it.icon} tintColor={it.destructive ? '#E5484D' : 'white'} size={18} />
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { position: 'absolute', right: 20, width: 240, borderRadius: 14, backgroundColor: '#2A2A2C', paddingVertical: 6, overflow: 'hidden' },
  header: { fontSize: 12, color: 'rgba(255,255,255,0.5)', paddingHorizontal: 14, paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  itemText: { fontSize: 16, color: 'white' },
  destructive: { color: '#E5484D' },
});
