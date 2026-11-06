// expo-router deep-link path hook. expo-router calls this for every incoming
// URL — cold (getInitialURL, initial:true) and warm (url events, initial:false)
// — to decide what to navigate to.
//
// airgapp://enrol?... is the Pi-relay enrolment QR. It is NOT a screen — it is
// handled by useEnrolIntake, which listens on the RAW react-native Linking
// event (independent of expo-router) and shows a confirmation prompt. We must
// NOT let expo-router navigate for it: there is no /enrol route, so it pushes
// the full-screen "Unmatched Route" over the live Godot car view and crashes
// the engine (SIGSEGV/SIGABRT in -[GLView drawView] off the CADisplayLink); and
// an absorber route still perturbs the lifecycle (the app "minimizes" on cold).
//
// `path` arrives as the FULL url (e.g. "airgapp://enrol?..."), not "/enrol", so
// strip the scheme + slashes before matching the first segment.
//
// Return value:
//   warm (initial=false): '' — expo-router only navigates on a TRUTHY return
//     (expo-router/build/link/linking.js: `if (href) listener(href)`), so '' =
//     do nothing, no stack change, Godot untouched.
//   cold (initial=true): '/' — returning '' here would make getInitialURL yield
//     an empty path that resolves to the Unmatched route (crash); '/' just boots
//     to index normally.
// Either way useEnrolIntake still receives the original airgapp://enrol URL via
// Linking and prompts. Every other path falls through unchanged.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const head = path
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // strip "scheme://"
      .replace(/^\/+/, '') // strip leading slashes (airgapp:///enrol → enrol)
      .split(/[?#/]/)[0]
      .toLowerCase();
    if (head === 'enrol') {
      return initial ? '/' : '';
    }
  } catch {
    // Never let a rewrite error break deep-link handling.
  }
  return path;
}
