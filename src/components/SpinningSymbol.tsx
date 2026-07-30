import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { TeslaIcon, type TeslaIconName } from '@/icons/TeslaIcon';

interface Props {
  name: TeslaIconName;
  tintColor: string;
  size: number;
  /** When true, the glyph rotates continuously (used for the climate fan while A/C is on). */
  spin?: boolean;
  /** Seconds per full revolution. */
  periodMs?: number;
}

// TeslaIcon wrapped in an Animated.View that rotates 360° on a loop while `spin` is true. Used to
// make the radially-symmetric `fan-filled` glyph read as an actually-spinning fan. Native-driven, so
// it stays smooth and off the JS thread.
export function SpinningSymbol({ name, tintColor, size, spin = false, periodMs = 1400 }: Props) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spin) {
      rotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: periodMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, periodMs, rotation]);

  const transform = spin
    ? [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
    : undefined;

  return (
    <Animated.View style={{ transform }}>
      <TeslaIcon name={name} color={tintColor} size={size} />
    </Animated.View>
  );
}
