import { DEFAULT_FAVORITES, type ControlActionId } from './controlActions';

// Favorites are PER-VEHICLE, matching the Tesla app. Confirmed from the decompiled
// bundle: it keeps a `quickControlsLayout` MAP keyed by VIN in
// `vehiclePresentationState` (reducer writes `quickControlsLayout[vin] = layout`,
// read via `getSelectedQuickControlsLayout`, default `{}`). So each car owns its
// favorites bar and switching cars swaps it.
export interface Preferences {
  favoritesByVehicle: Record<string, ControlActionId[]>;
}

export const defaultPreferences: Preferences = {
  favoritesByVehicle: {},
};

// The favorites for one vehicle — its stored order, or the shared default set when
// it has never been customized (Tesla defaults an unseen VIN to an empty layout
// its UI fills with the standard set; we return that set directly).
export function favoritesFor(prefs: Preferences, vehicleId: string): ControlActionId[] {
  return prefs.favoritesByVehicle[vehicleId] ?? [...DEFAULT_FAVORITES];
}

// Drop `id` into `slotIndex` for ONE vehicle. If `id` already occupies another slot
// for that vehicle, the two SWAP (keeps favorites duplicate-free). If `id` already
// sits in `slotIndex`, returns the same object (no-op). Out-of-range index is
// ignored. Pure — never mutates the input, and never touches another vehicle.
export function setFavoriteSlot(
  prefs: Preferences,
  vehicleId: string,
  slotIndex: number,
  id: ControlActionId,
): Preferences {
  const favorites = favoritesFor(prefs, vehicleId);
  if (slotIndex < 0 || slotIndex >= favorites.length) {
    return prefs;
  }
  if (favorites[slotIndex] === id) {
    return prefs;
  }
  const next = [...favorites];
  const existing = next.indexOf(id);
  if (existing !== -1) {
    next[existing] = next[slotIndex];
  }
  next[slotIndex] = id;
  return {
    ...prefs,
    favoritesByVehicle: { ...prefs.favoritesByVehicle, [vehicleId]: next },
  };
}

export type PreferencesAction = {
  type: 'setFavorite';
  vehicleId: string;
  slotIndex: number;
  id: ControlActionId;
};

export function preferencesReducer(prefs: Preferences, action: PreferencesAction): Preferences {
  switch (action.type) {
    case 'setFavorite':
      return setFavoriteSlot(prefs, action.vehicleId, action.slotIndex, action.id);
    default:
      return prefs;
  }
}
