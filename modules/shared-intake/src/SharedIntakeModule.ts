import { requireOptionalNativeModule } from 'expo';

declare class SharedIntakeModule {
  // What the Share Extension recorded about its own runs, plus the App Group
  // container path it resolved. The extension has no console; this is the only
  // way to see why a share queued nothing.
  readShareTrace(): Promise<string>;
  // Publish whether the app currently holds a BLE link to the car. The Share
  // Extension reads this to decide whether to use the Pi (in range — do not
  // contend for the radio) or BLE. Stale or absent reads as IN RANGE.
  writeCarPresence(linkUp: boolean): Promise<void>;
  // Legacy single-slot intent, drained once on upgrade. The extension no longer
  // writes it — it is the store whose clear-before-send behaviour lost places.
  consumeSharedIntent(): Promise<string | null>;
  // ANDROID ONLY. Dismisses the share sheet's own activity (ShareActivity) once the sheet has
  // shown its verdict. There is no iOS equivalent: an extension ends itself through
  // extensionContext.completeRequest, which is not reachable from JS. Optional-chained at every
  // call site so the iOS bundle, which registers the same component but never mounts it, is
  // unaffected.
  finishShare?(): Promise<void>;
  // ANDROID ONLY. Fired when a share arrives at an already-mounted sheet. ShareActivity is
  // singleTop, so a second share reuses the instance via onNewIntent and does NOT recreate the
  // React surface — without this the sheet would sit on the previous share's verdict.
  addListener?(event: 'onShareIntent', listener: () => void): { remove(): void };
}

// Optional: the Share Extension is an iOS target, so this is null on Android until the
// ACTION_SEND intake lands. Every caller null-checks; none of them are load-bearing for boot.
export default requireOptionalNativeModule<SharedIntakeModule>('SharedIntake');
