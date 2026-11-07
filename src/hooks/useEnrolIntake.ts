import { useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';

import { parseEnrolUrl, savePiConfig } from '@/ble/config';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
import { useCarLinkStatus } from '@/state/VehicleProvider';

// hostOf strips the scheme + path off an https base URL for display, without the
// global `URL` (Hermes may lack it — the same reason parseEnrolUrl is hand-rolled).
function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//i, '').split('/')[0] || baseUrl;
}

// Provisions the Pi forwarder from an `airgapp://enrol?...` deep link — the QR
// shown on the Pi dashboard scanned with the phone's camera, or the link tapped
// directly. Adding a forwarder opens a network path to the car, so we ALWAYS
// confirm with the user before saving, and write NOTHING on a decline. Direct
// BLE is unaffected either way. Runs on cold launch (getInitialURL) and on every
// foreground `url` event. Non-enrol links (shared locations, etc.) fall through
// untouched — parseEnrolUrl returns null for anything that isn't ours.
export function useEnrolIntake(): void {
  const { reload, refresh } = useCarLinkStatus();
  const inFlight = useRef(false);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const handle = (incoming: string | null) => {
      if (!incoming || inFlight.current) return;
      const parsed = parseEnrolUrl(incoming);
      if (!parsed) return; // not an enrol link
      // getInitialURL and the first 'url' event can both deliver the cold-launch
      // link; don't prompt twice for the same one.
      if (incoming === lastUrl.current) return;
      lastUrl.current = incoming;
      inFlight.current = true;

      // Show the relay host, not the QR's nickname: the host is the thing the
      // user can recognise as their own Pi (the anti-phishing check), whereas
      // the nickname is just the token's label and reads as nonsense here.
      const host = hostOf(parsed.baseUrl);
      Alert.alert(
        'Add this car relay?',
        `airgapp will reach your car through ${host} when you're out of Bluetooth range.\n\n` +
          'Only add it if this relay is yours.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => void (inFlight.current = false) },
          {
            text: 'Connect',
            style: 'default',
            onPress: () => {
              savePiConfig(store, { baseUrl: parsed.baseUrl, token: parsed.token })
                .then(() => {
                  // Re-read the new relay config + rebuild the gateway…
                  reload();
                  // …then actively go live. Without this the car sits idle until
                  // the next poll (or forever, if the poll loop had given up after
                  // the pre-enrol all-transports-failed). reload() loads the config
                  // asynchronously, so kick refresh() once the gateway's had time
                  // to rebuild, with a second attempt as a safety net for that race.
                  setTimeout(() => refresh(), 700);
                  setTimeout(() => refresh(), 2000);
                })
                .catch(() => {})
                .finally(() => void (inFlight.current = false));
            },
          },
        ],
        { cancelable: true, onDismiss: () => void (inFlight.current = false) },
      );
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [reload]);
}
