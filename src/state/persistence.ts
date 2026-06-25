// Generic, storage-agnostic persistence. The default backend is in-memory (no native module), so
// features can ship JS-only. Swapping in an AsyncStorage-backed `AppStorage` (and rebuilding) makes
// every consumer persist across app launches with no other changes.

export interface AppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createMemoryBackend(): AppStorage {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
}

// One shared in-memory backend for the app. Replace with an AsyncStorage adapter later.
export const memoryBackend: AppStorage = createMemoryBackend();

export async function load<T>(storage: AppStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (raw == null) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Debounced saver: repeated calls within `delayMs` collapse into one write of the latest value.
export function makeSaver<T>(storage: AppStorage, key: string, delayMs = 300): (value: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T;
  return (value: T) => {
    pending = value;
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void storage.setItem(key, JSON.stringify(pending));
    }, delayMs);
  };
}
