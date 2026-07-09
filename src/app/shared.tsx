import { Redirect } from 'expo-router';

// airgapp://shared is only a wake signal from the Share Extension — the root intake hook
// (useSharedLocationIntake) consumes the App Group payload on foreground and navigates to /location itself.
// This route just avoids an unmatched-route flash by redirecting home.
export default function SharedRoute() {
  return <Redirect href="/" />;
}
