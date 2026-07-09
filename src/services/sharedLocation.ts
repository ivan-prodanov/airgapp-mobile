import type { LatLng } from '@/state/mockLocation';

export type ShareSource = 'apple' | 'google' | 'waze' | 'unknown';
export interface SharedLocation { coordinate: LatLng; name?: string; source: ShareSource }
export interface RawExtract { coordinate?: LatLng; name?: string; address?: string; source: ShareSource }

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

// Niemeyer base32 geohash → the CENTER of the addressed cell. Even-index bits refine longitude
// [-180,180], odd-index bits refine latitude [-90,90]; bit=1 → upper half. (Used by Waze /ul/h<hash>.)
export function decodeGeohash(hash: string): LatLng {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let even = true; // longitude first
  for (const ch of hash.toLowerCase()) {
    const idx = GEOHASH_ALPHABET.indexOf(ch);
    if (idx < 0) continue; // skip stray chars defensively
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (even) {
        const mid = (lonLo + lonHi) / 2;
        if (on) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (on) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latitude: (latLo + latHi) / 2, longitude: (lonLo + lonHi) / 2 };
}
