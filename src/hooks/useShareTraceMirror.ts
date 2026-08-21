import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import SharedIntake from '../../modules/shared-intake';
import { appStorage } from '@/state/appStorage';
import { logi, logw } from '@/services/logbus';

// Where the mirror got to last time, ACROSS LAUNCHES.
//
// A useRef reset to 0 on every mount, so each app launch re-logged the entire
// trace file from the top. Measured 2026-07-28: 744 of 2042 diagnostic lines were
// re-mirrored duplicates — the single largest category in the log, crowding out
// the evidence the log exists for, and worse the longer the trace grew.
const WATERMARK_KEY = 'share.trace.watermark.v1';

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
// Only NEW lines are logged. The watermark is the LAST LINE MIRRORED, matched by
// content rather than by an index: the extension rotates its trace at 64 KB, so a
// stored count would silently point into the middle of a different file after a
// rotation and skip everything before it.
export function useShareTraceMirror(): void {
  const watermark = useRef<string | null>(null);

  const mirror = useCallback(async () => {
    if (!SharedIntake) return;  // no Share Extension to mirror a trace from
    try {
      const raw = await SharedIntake.readShareTrace();
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) return;

      if (watermark.current === null) {
        watermark.current = (await appStorage.getItem(WATERMARK_KEY)) ?? '';
      }
      // Everything after the last line we mirrored. A watermark we cannot find
      // means the trace rotated (or this is a first run), so take it all —
      // duplicating once is better than losing the window silently.
      const at = watermark.current ? lines.lastIndexOf(watermark.current) : -1;
      const fresh = at >= 0 ? lines.slice(at + 1) : lines;
      if (fresh.length === 0) return;
      watermark.current = lines[lines.length - 1];
      await appStorage.setItem(WATERMARK_KEY, watermark.current);
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
