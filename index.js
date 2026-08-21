// App entry.
//
// `expo-router/entry` registers the "main" component and owns the whole app. It stays FIRST — the
// router's own side effects (route registration, the polyfills src/app/_layout.tsx pulls in) must
// run before anything else touches the runtime.
//
// The second registration is the Android share sheet. ShareActivity is a separate ReactActivity
// whose main component is "shareSheet", so that name has to exist in the bundle by the time the
// activity starts. Both activities share ONE React host and one JS context, which is the whole
// reason the sheet can use the app's real BLE stack instead of the JSC engine iOS needs.
//
// Registering it on iOS too is deliberate and free: iOS shares go to the Share Extension, so
// nothing ever mounts this component there, and keeping one entry file avoids a platform split
// whose only job would be to skip an AppRegistry call.
import 'expo-router/entry';

import { AppRegistry } from 'react-native';

import ShareSheet from './src/share/ShareSheet';

AppRegistry.registerComponent('shareSheet', () => ShareSheet);
