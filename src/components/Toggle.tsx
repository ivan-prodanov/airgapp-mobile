import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

// Tesla-blue "on" track; iOS dark "off" track.
const TRACK_ON = '#3E6AE1';
const TRACK_OFF = '#39393D';

// Classic round-thumb toggle (the pre-iOS-26 look the Tesla app keeps). RN's native <Switch> now renders
// the iOS-26 restyle, so we draw our own: a pill track that fades grey↔blue and a white circle that slides.
export function Toggle({
  value,
  onToggle,
  disabled,
}: {
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [value, anim]);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  const backgroundColor = anim.interpolate({ inputRange: [0, 1], outputRange: [TRACK_OFF, TRACK_ON] });
  return (
    <Pressable onPress={onToggle} hitSlop={8} disabled={disabled} style={disabled ? styles.disabled : undefined}>
      <Animated.View style={[styles.track, { backgroundColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.4,
  },
  track: {
    width: 51,
    height: 31,
    borderRadius: 15.5,
    padding: 2,
  },
  thumb: {
    width: 27,
    height: 27,
    borderRadius: 13.5,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
});
