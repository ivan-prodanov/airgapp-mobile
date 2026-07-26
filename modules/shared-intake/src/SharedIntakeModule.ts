import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's resolved shared intent JSON (or null). Also clears any legacy payload.
  consumeSharedIntent(): Promise<string | null>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
