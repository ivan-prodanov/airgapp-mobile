import { requireOptionalNativeModule } from 'expo';

declare class BgTaskModule {
  // UIApplication.beginBackgroundTask — returns the raw task identifier, or
  // null when the assertion couldn't be taken.
  beginBackgroundTask(name: string): number | null;
  // UIApplication.endBackgroundTask — idempotent, never throws on a stale id.
  endBackgroundTask(id: number): void;
}

// Optional on purpose: this is iOS-only, and a JS-only deploy onto a binary
// built before the module existed would otherwise hard-crash at import.
// Callers get the no-assertion fallback instead (see index.ts).
export default requireOptionalNativeModule<BgTaskModule>('BgTask');
