import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// The official app's header spinner, asset and all.
//
// Source: docs/superpowers/research/tesla-status-assets-FINDINGS.md §D — the
// image IS theirs, extracted from split_assets_pack.apk!assets/img/mini_spinner.png
// (36x36 RGBA, a pure-white graded-alpha arc, shipped single-density). #117231
// passes no tint, so it renders white as-is; on the dark header it reads as a
// faint white arc. Animation per §F/Round-2 §3: linear, ~900ms/turn, infinite,
// native-driven.
const SPIN_DURATION_MS = 900;
// findings §D/Round-2 §2: the header overrides BusyIcon's default 20 to 18.
const DEFAULT_SIZE = 18;

export function BusyIcon({ size = DEFAULT_SIZE }: { size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.Image
      source={require('@/assets/images/mini_spinner.png')}
      style={{ width: size, height: size, transform: [{ rotate }] }}
    />
  );
}
