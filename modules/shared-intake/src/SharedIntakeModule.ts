import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's resolved shared intent JSON (or null). Also clears any legacy payload.
  consumeSharedIntent(): Promise<string | null>;
  // Mirror whether a saved trip exists (+ its name) so the Share Extension can enable/label "Add to Trip".
  setSavedTrip(exists: boolean, name: string | null): Promise<void>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
