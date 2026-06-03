import { StyleSheet, Text, View } from 'react-native';

interface StatusPillProps {
  label: string;
  value: string;
  active?: boolean;
}

// RN port of web-shell StatusPill (div + Tailwind → View + StyleSheet).
export function StatusPill({ label, value, active = false }: StatusPillProps) {
  return (
    <View style={[styles.pill, active ? styles.active : styles.idle]}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  active: {
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  idle: {
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.45)',
  },
  value: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
});
