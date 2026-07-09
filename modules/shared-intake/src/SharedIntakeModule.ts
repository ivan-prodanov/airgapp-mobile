import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's pending shared string (or null if none).
  consumePendingShare(): Promise<string | null>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
