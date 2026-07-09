import { Redirect } from 'expo-router';

// airgapp://shared is only a wake signal from the Share Extension — the root intake hook
// (useSharedLocationIntake) has already consumed the App Group payload and routed to /location by the time
// this mounts. This route just avoids an unmatched-route flash by falling back home.
export default function SharedRoute() {
  return <Redirect href="/" />;
}
