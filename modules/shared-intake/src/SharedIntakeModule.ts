import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's pending shared string (or null if none).
  consumePendingShare(): Promise<string | null>;
  // Debug logging shared between the extension and the app (App Group file).
  appendLog(line: string): Promise<void>;
  // Returns the shared debug log AND mirrors it into the app's Documents dir (pullable via devicectl).
  dumpLog(): Promise<string>;
  clearLog(): Promise<void>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
