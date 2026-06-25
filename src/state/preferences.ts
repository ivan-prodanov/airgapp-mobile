import { DEFAULT_FAVORITES, type ControlActionId } from './controlActions';

export interface Preferences {
  favorites: ControlActionId[];
}

export const defaultPreferences: Preferences = {
  favorites: [...DEFAULT_FAVORITES],
};

// Drop `id` into `slotIndex`. If `id` already occupies another slot, the two slots SWAP (keeps
// favorites duplicate-free). If `id` already sits in `slotIndex`, returns the same object (no-op).
// Out-of-range index is ignored. Pure — never mutates the input.
export function setFavoriteSlot(
  prefs: Preferences,
  slotIndex: number,
  id: ControlActionId,
): Preferences {
  const { favorites } = prefs;
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
  return { ...prefs, favorites: next };
}

export type PreferencesAction = { type: 'setFavorite'; slotIndex: number; id: ControlActionId };

export function preferencesReducer(prefs: Preferences, action: PreferencesAction): Preferences {
  switch (action.type) {
    case 'setFavorite':
      return setFavoriteSlot(prefs, action.slotIndex, action.id);
    default:
      return prefs;
  }
}
