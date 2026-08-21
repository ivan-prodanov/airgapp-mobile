// ShareSheet — the Android counterpart of the iOS Share Extension's popup.
//
// Sharing a place into airgapp IS the decision: the car gets it, and there is nothing here to
// preview, reorder or choose. So this is a small modal that reports progress and dismisses itself —
// NOT the app. Before this, an ACTION_SEND intent opened MainActivity on the Location screen with
// the pin dropped, which meant the whole app (and the Godot engine) booted just to forward one
// coordinate, and the user landed somewhere they had not asked to go.
//
// It is rendered by ShareActivity, a second ReactActivity registered as the ACTION_SEND target.
// Android's advantage over iOS is that the share arrives IN OUR OWN PROCESS: both activities share
// one React host and one JS context, so this runs the app's real BLE stack directly. iOS cannot —
// its extension is a separate process, which is why it embeds a JSC engine and a whole Swift
// transport layer to reach the same TypeScript.
//
// The four states mirror the iOS sheet exactly (ShareViewController.swift):
//   Sharing to car → Sent | Error | Timed out, with a live stage line underneath.
// The stage line is not decoration. Resolving a Google short link is a network round trip and
// opening a cold BLE session is legitimately seconds of work; without it the sheet is a spinner
// with no way to tell "working on it" from "hung".
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';

import { TESLA_FONT_MAP } from '@/constants/fonts';

import SharedIntake from '../../modules/shared-intake';
import { createCarGateway } from '@/ble/gateway';
import { BridgedBleTransport } from '@/ble/bridgedBleTransport';
import { foregroundBleLink } from '@/ble/foregroundBleLink';
import { loadCarConfig } from '@/ble/config';
import { loadDeviceKeys } from '@/ble/keystore';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
import { destinationTitle } from '@/services/destinationTitle';
import { parseSharedLocation, type SharedLocation } from '@/services/sharedLocation';
import { sharedLocationDeps } from '@/services/sharedLocationDeps';
import { logi } from '@/services/logbus';

/**
 * The whole-sheet budget. It must exceed the work it will actually walk — resolution (up to 8s)
 * plus a cold BLE connect and the command — or the send is cut off before it could ever land. The
 * iOS sheet allows 35s across two transports; this one only has BLE, so 25s is the same margin.
 */
const SHEET_DEADLINE_MS = 25_000;

/** How long to wait for the native central to bring the link up before giving up on BLE. */
const LINK_WAIT_MS = 12_000;

/** How long the command itself may take once the link is up. */
const COMMAND_DEADLINE_MS = 12_000;

/** Show the verdict briefly, then dismiss — the user gets an outcome, not a sheet that vanishes. */
const TERMINAL_LINGER_MS = 1_600;

type Phase = 'working' | 'done';

interface Status {
  phase: Phase;
  /** The big line: "Sharing to car" while working, then the verdict. */
  title: string;
  /** The place, once known. On success it is the confirmation; on failure it is what you'd retry. */
  detail?: string;
  /** The live commentary. */
  stage?: string;
}

/** Wait for `pred` to hold, polling, or resolve false at the deadline. */
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return pred();
}

export default function ShareSheet() {
  // The app's typeface is loaded by src/app/_layout.tsx, which only ever runs in MainActivity — so
  // this activity has to load it itself or the sheet renders in Roboto.
  //
  // NOT a render gate, unlike the app. A Text keeps whatever face it resolved AT MOUNT, which is
  // why _layout.tsx refuses to render until the faces land — but a share sheet that renders
  // NOTHING while it waits is a black screen over the app you shared from, and if the load never
  // resolves it stays black forever. So the card always renders, and `key` remounts it when the
  // faces arrive, which re-resolves every Text without hiding anything.
  const [fontsLoaded] = useFonts(TESLA_FONT_MAP);
  const [status, setStatus] = useState<Status>({
    phase: 'working',
    title: 'Sharing to car',
    stage: 'Finding the location…',
  });
  // Guards every terminal path: a resolver or a deadline firing twice must not overwrite a verdict
  // that has already been shown, and must not schedule a second dismissal.
  const settled = useRef(false);

  useEffect(() => {
    let disposed = false;
    logi('share', 'sheet mounted');

    const finish = (title: string, detail?: string, stage?: string) => {
      if (settled.current || disposed) return;
      settled.current = true;
      setStatus((s) => ({ phase: 'done', title, detail: detail ?? s.detail, stage }));
      setTimeout(() => SharedIntake?.finishShare?.(), TERMINAL_LINGER_MS);
    };

    // The sheet must not hang forever if a transport stalls. Names the stage it died in — "timed
    // out" alone cannot tell a car that is not there from a link that never came up.
    const deadline = setTimeout(() => {
      setStatus((s) => {
        logi('share', 'sheet timed out', { stage: s.stage });
        return s;
      });
      finish('Timed out', undefined, 'Try sharing again');
    }, SHEET_DEADLINE_MS);

    void (async () => {
      try {
        const json = await SharedIntake?.consumeSharedIntent();
        if (!json) return finish('Error', 'Nothing was shared');

        let raw: string | undefined;
        let known: SharedLocation | null = null;
        try {
          const intent = JSON.parse(json) as {
            raw?: string;
            location?: {
              lat: number;
              lng: number;
              name?: string;
              address?: string;
              source: SharedLocation['source'];
            };
          };
          raw = intent.raw;
          if (intent.location) {
            const { lat, lng, name, address, source } = intent.location;
            known = { coordinate: { latitude: lat, longitude: lng }, name, address, source };
          }
        } catch {
          return finish('Error', "Couldn't read that share");
        }

        const loc = known ?? (raw ? await parseSharedLocation(raw, sharedLocationDeps) : null);
        if (disposed) return;
        if (!loc) return finish('Error', "Couldn't read that location");

        // Name the place the moment we know it: the most reassuring thing this sheet can show is
        // that it read the right location.
        const label = destinationTitle(loc);
        setStatus((s) => ({ ...s, detail: label, stage: 'Trying Bluetooth…' }));

        const [carCfg, keys] = await Promise.all([loadCarConfig(store), loadDeviceKeys(store)]);
        if (disposed) return;
        if (!carCfg?.vin || !keys) {
          return finish('Error', label, 'Open airgapp once to finish setup');
        }

        // The native central owns the link; BridgedBleTransport is a thin adapter over it, so it
        // has to be running before the gateway can open a session.
        foregroundBleLink.start(carCfg.vin);
        const up = await waitFor(() => foregroundBleLink.isConnected(), LINK_WAIT_MS);
        if (disposed) return;
        if (!up) return finish('Error', label, "Couldn't reach your car — try again");

        const gw = createCarGateway({
          transport: new BridgedBleTransport(),
          vin: carCfg.vin,
          deviceKeys: keys,
          commandDeadlineMs: COMMAND_DEADLINE_MS,
        });
        const outcome = await gw.runCommand({
          type: 'navigateTo',
          lat: loc.coordinate.latitude,
          lon: loc.coordinate.longitude,
          label,
        });
        if (disposed) return;

        // Exactly the reading the iOS sheet does. ok:true is the ROUTABLE layer accepting the
        // frame; the car's own answer is in carStatus, and its ABSENCE is not consent — reporting
        // an unverified send as delivered is what makes a place arrive after the user moved on.
        if (!outcome.ok) {
          const refused = outcome.kind === 'fault';
          logi('share', 'send failed', { kind: outcome.kind, message: outcome.message });
          return finish(
            'Error',
            label,
            refused
              ? (outcome.message ?? "Your car wouldn't accept that place")
              : "Couldn't reach your car — try again",
          );
        }
        if (outcome.carStatus?.ok === true) {
          logi('share', 'send accepted', { label });
          return finish('Sent', label, undefined);
        }
        if (outcome.carStatus?.ok === false) {
          return finish(
            'Error',
            label,
            outcome.carStatus.reason ?? "Your car wouldn't accept that place",
          );
        }
        return finish('Error', label, "Couldn't confirm — try again");
      } catch (err) {
        logi('share', 'sheet threw', { err: String(err) });
        finish('Error', undefined, 'Something went wrong');
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(deadline);
    };
  }, []);

  return (
    <View style={styles.scrim}>
      <View style={styles.card} key={fontsLoaded ? 'fonts' : 'fallback'}>
        {status.phase === 'working' ? (
          <ActivityIndicator size="large" color="#F1F1F1" style={styles.spinner} />
        ) : null}
        <Text style={styles.title}>{status.title}</Text>
        {status.detail ? <Text style={styles.detail}>{status.detail}</Text> : null}
        {status.stage ? <Text style={styles.stage}>{status.stage}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The activity's window is transparent, so the scrim is ours to draw — it is what makes this
  // read as a sheet over whatever app the user shared from, rather than as a screen.
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    minWidth: 260,
    maxWidth: 340,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    // The app's own surface colour, so the sheet is recognisably airgapp.
    backgroundColor: '#222324',
  },
  spinner: { marginBottom: 14 },
  title: {
    fontFamily: 'UniversalSans',
    fontSize: 17,
    lineHeight: 22,
    color: '#F1F1F1',
    textAlign: 'center',
  },
  detail: {
    fontFamily: 'UniversalSans',
    fontSize: 14,
    lineHeight: 19,
    color: '#BFBFBF',
    textAlign: 'center',
    marginTop: 8,
  },
  stage: {
    fontFamily: 'UniversalSans',
    fontSize: 13,
    lineHeight: 18,
    color: '#8A8A8A',
    textAlign: 'center',
    marginTop: 6,
  },
});
