// destinationTitle — what we put in NavigationGpsDestinationRequest.destination,
// i.e. the text the car shows in its route list.
//
// Applied at the SEND boundary rather than at each of the four call sites (pin,
// POI, search result, charger), so there is exactly one place this can go wrong.
//
// The placeholder filter is the point of this module. Several sources synthesise
// a label purely so the UI has something to draw — a long-pressed pin starts as
// 'Dropped Pin' and only improves if reverse-geocoding happens to succeed. Those
// strings are fine on our own map and useless in a car's route list, so they are
// treated as ABSENT and we fall through to something that actually locates the
// place. "42.6977, 23.3219" tells you where you are going; "Dropped Pin" does not.
//
// No React Native imports — node-testable.

export interface TitleInput {
  name?: string | null;
  address?: string | null;
  coordinate: { latitude: number; longitude: number };
}

// Labels our own UI invents for display. Compared case-insensitively after
// trimming. Keep this list in sync with the strings the screens synthesise.
const PLACEHOLDERS = new Set(['dropped pin', 'location', 'shared location', 'unknown location', 'pin']);

export function isPlaceholderTitle(s: string): boolean {
  return PLACEHOLDERS.has(s.trim().toLowerCase());
}

// A usable title, or null. Blank/whitespace-only and placeholder strings are
// both "absent" as far as the fallback chain is concerned.
function usable(s: string | null | undefined): string | null {
  if (!s) return null;
  // Apple postal addresses are multi-line; the car shows a single row.
  const flat = s.replace(/\s*\n\s*/g, ', ').trim();
  if (!flat) return null;
  if (isPlaceholderTitle(flat)) return null;
  return flat;
}

export function destinationTitle({ name, address, coordinate }: TitleInput): string {
  return (
    usable(name) ??
    usable(address) ??
    `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`
  );
}
