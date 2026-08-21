import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

// Route Android's system back at an in-app overlay.
//
// WHY THIS IS NEEDED AT ALL (reported on device 2026-08-21): the app draws several
// things that LOOK like pushed screens but are not expo-router routes — Controls and
// Climate are camera modes on the single `index` route, and the bottom sheets are
// overlays. iOS is fine because the back affordance there is our own left-edge
// PanResponder strip (`index.tsx` `edgeBack`), a TOUCH handler.
//
// On Android that strip never fires. Gesture navigation consumes the edge swipe in the
// system before the app sees the touch, and dispatches a back EVENT instead. With no
// route to pop, the event falls through to the OS, which backgrounds the app — so
// swiping back out of Controls minimised the whole app instead of returning Home.
//
// `hardwareBackPress` is the one signal that catches BOTH the gesture-nav swipe and the
// 3-button back, so overlays subscribe to it while they are open and return true to
// consume it. When nothing is open we deliberately do NOT subscribe: backgrounding the
// app IS the correct Android behaviour at the root.
//
// iOS never emits `hardwareBackPress`, but we skip subscribing there anyway so this hook
// is provably a no-op on iOS rather than relying on the event never arriving.
export function useAndroidBack(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // handled — do not let the OS background the app
    });
    return () => sub.remove();
  }, [active, onBack]);
}
