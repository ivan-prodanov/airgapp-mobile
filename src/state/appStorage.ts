import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStorage } from './persistence';

// Real cross-launch backend (native). Isolated in its own file so pure/tested modules never transitively
// import AsyncStorage (which can't load under node/tsx). Import it ONLY from RN-only code that is never
// node-tested — today useCarLink.ts and useSchedules.ts; pure modules take an AppStorage argument instead.
export const appStorage: AppStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};
