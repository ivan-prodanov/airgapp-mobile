import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';

// The arrow glyph is ANGLED: `arrow.up.right` visually points to 45° (NE) at rest. We subtract that so
// a computed bearing of 0 makes the arrow point straight up. Swap the glyph → just change these two.
const GLYPH = 'arrow.up.right' as const;
const GLYPH_BASE_ANGLE = 45;

interface Props {
  // Geographic bearing (deg, 0 = true north, clockwise) from the phone to the car. For the mock this is
  // the car's stable offset bearing; with BLE it becomes bearing(phoneGPS → real car coords).
  bearingToCar: number;
  size?: number;
  color?: string;
}

// A compass arrow on the Home "Location" row that points at the car. It rotates by (bearing − device
// heading): face the car and it points up; rotate the phone and it swings to keep pointing at the car.
// Heading comes from expo-location (CLLocationManager), so it needs foreground location permission;
// without it we fall back to heading 0 (arrow points at the raw geographic bearing, north-up).
//
// The rotation is driven through an Animated.Value on a wrapper View (SymbolView doesn't reliably apply
// a transform on its own style) with the native driver, and the angle is kept CONTINUOUS (unwrapped) so
// crossing north (359°→1°) animates the short way instead of spinning all the way around.
export function CarHeadingArrow({ bearingToCar, size = 17, color = 'rgba(255,255,255,0.7)' }: Props) {
  const initial = bearingToCar - GLYPH_BASE_ANGLE; // heading 0 until the first compass reading
  const rotation = useRef(new Animated.Value(initial)).current;
  const currentDeg = useRef(initial);
  const bearingRef = useRef(bearingToCar);
  bearingRef.current = bearingToCar;

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      sub = await Location.watchHeadingAsync((h) => {
        // trueHeading is -1 until it has a location fix; fall back to magnetic north meanwhile.
        const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        const target = bearingRef.current - heading - GLYPH_BASE_ANGLE;
        // Add the smallest signed delta onto the running angle so we never wrap the long way round.
        const delta = ((target - currentDeg.current + 540) % 360) - 180;
        currentDeg.current += delta;
        Animated.timing(rotation, {
          toValue: currentDeg.current,
          duration: 90,
          useNativeDriver: true,
        }).start();
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <SymbolView name={GLYPH} tintColor={color} size={size} />
    </Animated.View>
  );
}
