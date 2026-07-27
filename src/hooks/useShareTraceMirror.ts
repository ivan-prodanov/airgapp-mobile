import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import SharedIntake from '../../modules/shared-intake';
import { logi, logw } from '@/services/logbus';

// Mirrors the Share Extension's trace into the app's diagnostics log.
//
// The extension is a separate process with no console, and its trace file lives
// in the App Group — which devicectl has repeatedly failed to enumerate, so
// pulling it off the device directly is not reliable. The app CAN read it, and
// the app's log is pullable, so the app carries it across.
//
// Without this, seeing why a share failed needs someone to open a debug screen
// and tap a button, which is exactly the kind of manual step that does not happen
// at the moment the bug occurs.
//
// Only NEW lines are logged: the trace is append-only, so mirroring all of it on
// every foreground would bury the log in repeats.
export function useShareTraceMirror(): void {
  const seen = useRef(0);

  const mirror = useCallback(async () => {
    try {
      const raw = await SharedIntake.readShareTrace();
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      // The first line is the resolved container path — worth having once, and it
      // is the line that explains everything else if the two processes disagree.
      const fresh = lines.slice(seen.current);
      if (fresh.length === 0) return;
      seen.current = lines.length;
      for (const line of fresh) {
        // Failures are warnings so they stand out in a log dominated by polling.
        const bad = /FAILED|nil|no usable|gave up|TIMED OUT|MISSING/i.test(line);
        (bad ? logw : logi)('share', line);
      }
    } catch (err) {
      logw('share', 'could not read the extension trace', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void mirror();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void mirror();
    });
    return () => sub.remove();
  }, [mirror]);
}
