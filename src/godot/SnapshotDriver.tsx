import { useEffect, useRef } from 'react';
import { File, Paths } from 'expo-file-system';

import { useGodotBridge } from './bridgeContext';
import { useFleet } from '@/state/VehicleProvider';
import { configForState } from './vehicleConfigForState';
import { configHash } from './vehicleConfigHash';
import { getSnapshot, setSnapshot } from '@/state/vehicleSnapshotStore';

const POSE = 'THREEQUARTER';

// Drives the per-car snapshot pipeline: for every car in the fleet, ensure a
// THREEQUARTER snapshot exists (reusing an on-disk PNG from a previous run, else
// asking the off-screen Godot SnapshotManager to render one), and route the
// results into vehicleSnapshotStore. Renders nothing — mount it once inside the
// Godot BridgeContext (it needs both the bridge and the fleet).
export function SnapshotDriver() {
  const bridge = useGodotBridge();
  const fleet = useFleet();
  const inFlight = useRef(new Set<string>());
  const ready = useRef(false);

  // Request any snapshots the current fleet is missing (once the renderer is up).
  const requestMissing = useRef<() => void>(() => {});
  requestMissing.current = () => {
    if (!ready.current) return;
    for (const v of fleet.vehicles) {
      const hash = configHash(configForState(v.state));
      if (getSnapshot(hash) || inFlight.current.has(hash)) continue;
      // Already rendered on a previous launch? The PNG persists — reuse it.
      try {
        const file = new File(Paths.document, 'snapshots', `${hash}_${POSE}.png`);
        if (file.exists) {
          setSnapshot(hash, file.uri);
          continue;
        }
      } catch {
        // exists-check can throw if the dir isn't there yet; fall through to request.
      }
      inFlight.current.add(hash);
      bridge.takeSnapshot(v.state, hash, [POSE]);
    }
  };

  useEffect(() => {
    const offSnap = bridge.onSnapshot((snap) => {
      inFlight.current.delete(snap.config_hash);
      // `path` is relative to user:// (= the app's Documents dir on iOS).
      setSnapshot(snap.config_hash, Paths.document.uri + snap.path);
    });
    const offRaw = bridge.onRawMessage((msg) => {
      if (!ready.current && (msg.type === 'GODOT_READY' || msg.type === 'FIRST_PRODUCT_LOADED')) {
        ready.current = true;
        requestMissing.current();
      }
    });
    // The renderer may already be up by the time we mount.
    const diag = bridge.getDiagnostics();
    if (diag.ready || diag.firstProductLoaded) {
      ready.current = true;
      requestMissing.current();
    }
    return () => {
      offSnap();
      offRaw();
    };
  }, [bridge]);

  // Re-check whenever the fleet changes (e.g. a car added via Add Car).
  useEffect(() => {
    requestMissing.current();
  }, [fleet.vehicles]);

  return null;
}
