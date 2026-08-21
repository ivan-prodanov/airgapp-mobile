import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSendToCar, type SendTarget } from '@/hooks/useSendToCar';
import { AppIcon } from '../icons/AppIcon';

// The single action on any place: the dropped pin, a tapped POI, a search result,
// a charger.
//
// It says "Send to Car" and not "Navigate" deliberately. With a route already
// running, f106 REPLACE drops a tappable pin on the centre screen instead of
// rerouting — and we cannot detect which of those two will happen, because route
// state is unreadable while the car is locked. "Send to Car" is true either way;
// "Navigate" would be a lie in one of them.
export function SendToCarButton({ target, onSent, onShare }: { target: SendTarget; onSent?: () => void; onShare?: () => void }) {
  const send = useSendToCar();
  return (
    <SafeAreaView edges={['bottom']} style={styles.bar} pointerEvents="box-none">
      <View style={styles.row}>
        {onShare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share location"
            style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.6 : 1 }]}
            onPress={onShare}
          >
            <AppIcon icon="share" color="white" size={20} />
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => {
            send(target);
            onSent?.();
          }}
        >
          <AppIcon icon="directions" color="white" size={17} />
          <Text style={styles.label}>Send to Car</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#161616',
  },
  row: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  button: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#3E6AE1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // Secondary square action beside the primary button. Subtle fill on the bar's
  // #161616 so "Send to Car" stays the prominent one.
  shareButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: 'white', fontSize: 17, fontWeight: '700' },
});
