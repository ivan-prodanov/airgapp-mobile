import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's resolved shared intent JSON (or null). Also clears any legacy payload.
  consumeSharedIntent(): Promise<string | null>;
  // Mirror the saved trip (exists flag, last-stop name, and the ordered stops as JSON) so the Share Extension
  // can enable "Add to Trip" and draw/list the trip. stopsJson = `[{title, lat, lng, kind}]`.
  setSavedTrip(exists: boolean, name: string | null, stopsJson: string | null): Promise<void>;
  // Mirror the car's current stop JSON (`{id,kind,title,lat,lng}`) so the extension can build a fresh "New Trip".
  setSavedCar(json: string | null): Promise<void>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
