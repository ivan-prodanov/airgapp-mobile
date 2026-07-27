import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // The durable outbox, as a JSON array of items (see src/state/shareOutbox.ts for
  // the shape and the rules). Reading does NOT consume: an item leaves the queue
  // only when the app writes back a list without it, and only after the car has
  // confirmed the destination.
  readOutbox(): Promise<string>;
  writeOutbox(json: string): Promise<boolean>;
  // Legacy single-slot intent, drained once on upgrade. The extension no longer
  // writes it — it is the store whose clear-before-send behaviour lost places.
  consumeSharedIntent(): Promise<string | null>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
