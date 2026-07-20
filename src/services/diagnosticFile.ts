// diagnosticFile.ts — append diagnostics to a file in the app's Documents
// directory so they can be pulled OFF the device and read on a workstation.
//
// Why this exists: on-device diagnostics previously lived only in the harness's
// in-memory log, which means reading them requires squinting at a phone and
// retyping hex by hand. RN console.log does NOT reach the device syslog in a
// Hermes Release build either (only native NSLog does), so there was no way to
// get bytes off the device at all.
//
// Pull the file with:
//   xcrun devicectl device copy from --device <udid> \
//     --domain-type appDataContainer --domain-identifier local.airgapp.mobile \
//     --source Documents/airgapp-diagnostics.log --destination ./
//
// expo-file-system is pinned to 56.0.7 — the SAME version already compiled into
// the binary as a transitive dep of expo. That matters: importing a native
// module NEWER than what's linked produces a dyld "Symbol not found" crash at
// launch, and a JS-only deploy can't fix it. Pinned this way, deploy-js.sh is safe.
//
// Best-effort by design: diagnostics must never break the flow being
// diagnosed, so every failure is swallowed and reported via the return value.

import { Directory, File, Paths } from 'expo-file-system';

export const DIAGNOSTIC_FILENAME = 'airgapp-diagnostics.log';

function stamp(): string {
  return new Date().toISOString();
}

// appendDiagnostic writes one titled block of lines, timestamped. Returns the
// file path on success, or null if anything went wrong (never throws).
// NOTE async: File.text() returns a Promise. An earlier version treated it as
// sync, so `previous` was a Promise object — it stringified to "[object Object]"
// AND silently discarded the existing log on every append, leaving only the most
// recent block. Appending must await the read.
// Appends are SERIALIZED through this chain. Each append is read-whole-file →
// write-whole-file, so two concurrent calls both read the same `previous` and
// the second clobbers the first — a lost update. That is not theoretical: during
// the first M1 on-car run the passive-entry log lines were silently destroyed by
// the ~1 Hz frame-capture appends racing them, and the most important evidence
// of the run went missing. Serializing costs nothing at these volumes.
let appendChain: Promise<unknown> = Promise.resolve();

export function appendDiagnostic(title: string, lines: string[]): Promise<string | null> {
  const next = appendChain.then(() => appendDiagnosticUnsafe(title, lines));
  // Keep the chain alive even if one append rejects.
  appendChain = next.catch(() => undefined);
  return next;
}

async function appendDiagnosticUnsafe(title: string, lines: string[]): Promise<string | null> {
  try {
    const dir: Directory = Paths.document;
    const file = new File(dir, DIAGNOSTIC_FILENAME);
    if (!file.exists) {
      file.create();
    }
    let previous = '';
    try {
      previous = (await file.text()) ?? '';
    } catch {
      previous = ''; // unreadable/new file — start fresh rather than lose the new block
    }
    const block = [`===== ${title} @ ${stamp()} =====`, ...lines, ''].join('\n');
    file.write(previous ? `${previous}\n${block}` : block);
    return file.uri;
  } catch {
    return null;
  }
}

// clearDiagnostics truncates the log so a fresh run isn't read against stale
// output — the classic "am I looking at this run or the last one?" trap.
export function clearDiagnostics(): boolean {
  try {
    const file = new File(Paths.document, DIAGNOSTIC_FILENAME);
    if (file.exists) file.write('');
    return true;
  } catch {
    return false;
  }
}
