import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { useGodotBridge } from './bridgeContext';

// The official app's content fade.
//
// Source: docs/superpowers/research/tesla-transitions-markers-FINDINGS.md
// §1c/§3d. Two things about it are easy to get wrong, and both matter:
//
//  1. THE CLOCK IS DATA-GATED, NOT MOUNT-GATED. It starts inside the
//     vehicle-markers callback (getVehicleMarkers -> setMarkers -> .start()),
//     so if the markers are slow the screen is already there while its content
//     sits at opacity 0. Fading on mount would look subtly different and would
//     de-sync the pieces.
//  2. ONE CLOCK DRIVES EVERYTHING ON THE SCREEN. Their Controls writes a single
//     Animated.Value into TEN opacity sites — 5 markers AND the 5 bottom
//     buttons — so the whole screen resolves as one object, not in waves.
//
// Every consumer of this hook subscribes to the same `onMarkers` event, so
// separate Animated.Values still start on the same frame and stay in lockstep —
// which is what their single shared value buys, without having to thread it
// through the tree.
//
// Their curve, verbatim: 300ms, Easing.cubic, useNativeDriver.
export const CONTENT_FADE_MS = 300;

export function useContentFade(): Animated.Value {
  const bridge = useGodotBridge();
  const fade = useRef(new Animated.Value(0)).current;
  const started = useRef(false);

  useEffect(() => {
    const off = bridge.onMarkers(() => {
      // First response only. The camera re-requests markers when it settles, and
      // restarting the ramp there would make the content blink mid-session.
      // (Brief #12 §3 asks what their own guard is.)
      if (started.current) return;
      started.current = true;
      Animated.timing(fade, {
        toValue: 1,
        duration: CONTENT_FADE_MS,
        easing: Easing.cubic,
        useNativeDriver: true,
      }).start();
    });
    // Ask now in case we arrived with the camera already at rest and the
    // markers have already been emitted.
    bridge.requestMarkers();
    return off;
  }, [bridge, fade]);

  return fade;
}
