// commandNotification.ts — the local notification the app posts when a car
// command fails while the app ISN'T on screen.
//
// The official app does exactly this: press a control, background the app, and
// if the command fails you get a local notification instead of a toast nobody
// would see. Copy mirrors it ("Unable to Complete Command" / "Open … to
// complete your request.").
//
// RN-only (expo-notifications), so — like useCarLink — this file is
// deliberately not node-tested and never added to the `test` script.
//
// Permission is requested LAZILY: the first time we actually need to post one,
// never at launch. A denied permission is a silent no-op — a failed command
// must never turn into a crash or a permission nag.

import * as Notifications from 'expo-notifications';

const TITLE = 'Unable to Complete Command';
const BODY = 'Open Air Gapp to complete your request.';

// Present the banner even if the app happens to be foregrounded when it fires
// (we only post while backgrounded, but the handler must exist for iOS to
// present at all). No sound/badge — a failed command isn't alarm-worthy.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Cached so a run of failures doesn't re-prompt (iOS only ever shows the system
// prompt once anyway, but this also avoids a getPermissionsAsync round-trip per
// failure). Reset on nothing — a permission change requires an app restart to
// matter, which clears it anyway.
let granted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    granted = true;
    return true;
  }
  // canAskAgain === false means the user has already said no for good; asking
  // again is a no-op that just costs a round-trip.
  if (!current.canAskAgain) {
    granted = false;
    return false;
  }
  const asked = await Notifications.requestPermissionsAsync();
  granted = asked.granted;
  return granted;
}

// notifyCommandFailure posts the failure notification. Never throws: a denied
// permission (or any expo-notifications error) is swallowed — the command has
// already failed, and the caller has rolled the UI back regardless.
export async function notifyCommandFailure(): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: TITLE, body: BODY },
      trigger: null, // fire immediately
    });
  } catch (err) {
    console.warn('[commandNotification] post failed', err);
  }
}
