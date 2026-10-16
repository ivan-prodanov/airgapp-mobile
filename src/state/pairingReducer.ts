import { isValidVin } from '../ble/config';

export type PairStep = 'vin' | 'connecting' | 'presentKey' | 'verifying' | 'paired' | 'error';
export interface PairState { step: PairStep; vin: string; error: string | null }
export type PairEvent =
  | { t: 'submitVin'; vin: string }
  | { t: 'connected' } | { t: 'connectFailed'; error: string }
  | { t: 'keySent' } | { t: 'verified' } | { t: 'verifyTimeout' }
  | { t: 'retry' } | { t: 'cancel' };

export const initialPairState: PairState = { step: 'vin', vin: '', error: null };

export function pairReducer(s: PairState, e: PairEvent): PairState {
  switch (e.t) {
    case 'submitVin':
      return isValidVin(e.vin)
        ? { step: 'connecting', vin: e.vin, error: null }
        : { ...s, step: 'vin', error: `"${e.vin}" is not a valid 17-character VIN` };
    case 'connected': return { ...s, step: 'presentKey', error: null };
    case 'connectFailed': return { ...s, step: 'error', error: e.error };
    case 'keySent': return { ...s, step: 'verifying', error: null };
    case 'verified': return { ...s, step: 'paired', error: null };
    case 'verifyTimeout': return { ...s, step: 'error', error: 'Pairing timed out — did you tap your key card on the console?' };
    case 'retry': return { ...s, step: 'connecting', error: null };
    case 'cancel': return initialPairState;
    default: return s;
  }
}
