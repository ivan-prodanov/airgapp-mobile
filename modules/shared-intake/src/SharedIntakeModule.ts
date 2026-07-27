import { requireNativeModule } from 'expo';

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
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
