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
    case 'submitVin': {
      if (s.step !== 'vin' && s.step !== 'error') return s;      // guard
      const vin = e.vin.trim().toUpperCase();                    // normalize (iBeacon derivation needs canonical VIN)
      return isValidVin(vin)
        ? { step: 'connecting', vin, error: null }
        : { ...s, step: 'vin', error: `"${vin}" is not a valid 17-character VIN` };
    }
    case 'connected':     return s.step === 'connecting' ? { ...s, step: 'presentKey', error: null } : s;
    case 'connectFailed': return s.step === 'connecting' ? { ...s, step: 'error', error: e.error } : s;
    case 'keySent':       return s.step === 'presentKey' ? { ...s, step: 'verifying', error: null } : s;
    case 'verified':      return s.step === 'verifying' ? { ...s, step: 'paired', error: null } : s;
    case 'verifyTimeout': return s.step === 'verifying'
      ? { ...s, step: 'error', error: 'Pairing timed out — did you tap your key card on the console?' } : s;
    case 'retry':         return s.step === 'error' ? { ...s, step: 'connecting', error: null } : s;
    case 'cancel':        return initialPairState;
    default: { const _exhaustive: never = e; void _exhaustive; return s; } // exhaustiveness guard
  }
}
