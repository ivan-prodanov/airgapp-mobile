// Locally-persisted Navigate recents, backed by a small SQLite table in expo-sqlite's default directory
// (survives app restarts; created on first use — no bundled asset). App-only (imports expo-sqlite); never
// imported by node:test or the build scripts. The pure day-grouping lives in recents.ts.
import * as SQLite from 'expo-sqlite';

import type { Place } from './place';
import type { RecentEntry } from './recents';

const RECENTS_DB = 'recents.db';
const CAP = 50; // keep the newest N

// undefined = not opened; null = unavailable; else the handle.
let db: SQLite.SQLiteDatabase | null | undefined;
function getDb(): SQLite.SQLiteDatabase | null {
  if (db !== undefined) return db;
  try {
    const handle = SQLite.openDatabaseSync(RECENTS_DB);
    handle.execSync(
      'CREATE TABLE IF NOT EXISTS recents (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, lat REAL, lng REAL, savedAt INTEGER)',
    );
    db = handle;
  } catch {
    db = null;
  }
  return db;
}

// Stable id from the coordinate so re-selecting the same place bumps its recency instead of duplicating
// (Apple result ids embed a volatile list index).
function recentId(place: Place): string {
  const c = place.coordinate!;
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

// Upsert a selected place as a recent (needs a coordinate), then prune to the newest CAP.
export function addRecent(place: Place, savedAt: number): void {
  const handle = getDb();
  if (!handle || !place.coordinate) return;
  handle.runSync(
    'INSERT OR REPLACE INTO recents (id, title, subtitle, lat, lng, savedAt) VALUES (?, ?, ?, ?, ?, ?)',
    recentId(place),
    place.title,
    place.subtitle ?? null,
    place.coordinate.latitude,
    place.coordinate.longitude,
    savedAt,
  );
  handle.runSync(
    'DELETE FROM recents WHERE id NOT IN (SELECT id FROM recents ORDER BY savedAt DESC LIMIT ?)',
    CAP,
  );
}

// Newest-first recents as RecentEntry[] (grouped for display by groupRecentsByDay).
export function loadRecents(): RecentEntry[] {
  const handle = getDb();
  if (!handle) return [];
  const rows = handle.getAllSync<{
    id: string; title: string; subtitle: string | null; lat: number; lng: number; savedAt: number;
  }>('SELECT id, title, subtitle, lat, lng, savedAt FROM recents ORDER BY savedAt DESC');
  return rows.map((r) => ({
    savedAt: r.savedAt,
    place: {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      coordinate: { latitude: r.lat, longitude: r.lng },
      kind: 'recent' as const,
      source: 'recent' as const,
    },
  }));
}
