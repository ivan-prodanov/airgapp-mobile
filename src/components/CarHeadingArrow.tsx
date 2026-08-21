import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import * as Location from 'expo-location';
import { AppIcon } from '../icons/AppIcon';

// The compass glyph is `navigate-filled` — the SAME nav-heading arrow the Location
// row shows at rest — so a known bearing just rotates the row's own icon to point at
// the car. It points STRAIGHT UP (north) at rest, so bearing 0 needs no offset.
//
// (The icon refactor 126304d mapped the old SF `arrow.up.right` to `external` — an
// external-LINK box, not an arrow — which is what turned the Location compass into a
// little link icon. GLYPH_BASE_ANGLE was 45 for that old diagonal SF arrow; a glyph
// that points straight up needs 0.) Swap the glyph → set the angle it points at rest
// (these glyphs are 0=up, 90=right, 180=down, 270=left, clockwise from up).
const GLYPH = 'navigate-filled' as const;
const GLYPH_BASE_ANGLE = 0;

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
// The rotation is driven through an Animated.Value on a wrapper View (the icon doesn't reliably apply
// a transform on its own style) with the native driver, and the angle is kept CONTINUOUS (unwrapped) so
// crossing north (359°→1°) animates the short way instead of spinning all the way around.
export function CarHeadingArrow({ bearingToCar, size = 17, color = 'rgba(255,255,255,0.7)' }: Props) {
  const initial = bearingToCar - GLYPH_BASE_ANGLE; // heading 0 until the first compass reading
  const rotation = useRef(new Animated.Value(initial)).current;
  const currentDeg = useRef(initial);
  const headingRef = useRef(0); // last device compass heading, so a bearing change can re-point with it
  const bearingRef = useRef(bearingToCar);
  bearingRef.current = bearingToCar;

  // Animate the glyph to point at `bearing` given the current device `heading`,
  // taking the shortest path around the circle. Stable identity (only touches
  // refs) so both effects below can call it. This is the SINGLE place rotation
  // updates — driven by EITHER a compass reading OR a bearing (location) change,
  // so the arrow follows a car/user-location update even when the phone is still.
  const animateTo = useRef((bearing: number, heading: number) => {
    const target = bearing - heading - GLYPH_BASE_ANGLE;
    // Add the smallest signed delta onto the running angle so we never wrap the long way round.
    const delta = ((target - currentDeg.current + 540) % 360) - 180;
    currentDeg.current += delta;
    Animated.timing(rotation, { toValue: currentDeg.current, duration: 90, useNativeDriver: true }).start();
  }).current;

  // Compass heading updates: re-point using the latest bearing.
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      sub = await Location.watchHeadingAsync((h) => {
        // trueHeading is -1 until it has a location fix; fall back to magnetic north meanwhile.
        const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        headingRef.current = heading;
        animateTo(bearingRef.current, heading);
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [animateTo]);

  // Bearing (car/user location) updates: re-point immediately with the last
  // heading — this is the piece that was missing, so the arrow only moved when
  // the phone rotated. Skips the initial mount (delta 0) harmlessly.
  useEffect(() => {
    animateTo(bearingToCar, headingRef.current);
  }, [bearingToCar, animateTo]);

  const rotate = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <AppIcon icon={GLYPH} color={color} size={size} />
    </Animated.View>
  );
}
