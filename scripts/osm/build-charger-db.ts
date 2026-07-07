/**
 * Build the on-device SQLite charger database from OSM data.
 *
 *   npx tsx scripts/osm/build-charger-db.ts --world        # fetch the whole planet from OSM, then build
 *   npx tsx scripts/osm/build-charger-db.ts <input.json>   # build from a dump / StoredCharger[] file
 *
 * <input.json> may be EITHER a raw Overpass dump ({ elements: [...] }) — each element mapped via
 * mapOsmElement — OR an already-mapped StoredCharger[] JSON array. Output
 * (default scripts/osm/out/chargers.db) is a SQLite DB with a lat index, queried by bbox at runtime
 * (src/services/chargerSource.ts). Normally you don't run this directly — scripts/godot-ios/deploy-chargers.sh
 * calls it (`--world`) and pushes the DB in one no-param command. Uses Node's built-in node:sqlite (≥ 22.5).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapOsmElement, type OsmElement, type StoredCharger } from '../../src/services/osm';

const HERE = dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[3] ?? join(HERE, 'out/chargers.db');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// One Overpass query → its elements, retried across mirrors (public instances are flaky). Tag-index
// queries (no bbox) don't time out like a planet area scan.
async function overpass(query: string, attempts = 2): Promise<OsmElement[]> {
  let last: Error | undefined;
  for (let a = 0; a < attempts; a += 1) {
    for (const mirror of MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'airgapp-charger-db/1.0' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(850_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return ((await res.json()) as { elements?: OsmElement[] }).elements ?? [];
      } catch (err) {
        last = err as Error;
      }
    }
  }
  throw last ?? new Error('overpass failed');
}

// `--world`: fetch EVERY charging_station on the planet. NODES in one tag-index query (~181k, `out body`);
// WAYS/RELATIONS (~12k stations mapped as areas) tiled by region with `out center` — a global areas query
// times out (centroid for every area on Earth), and dense regions (Europe) need fine tiles. Each tile is
// non-fatal, so a rate-limited miss just drops that region's areas (nodes still ship). Several minutes.
const AREA_TILES = [
  'na:5,-170,72,-50', 'sa:-56,-82,15,-34', 'af:-35,-20,38,52', 'oc:-48,110,0,180',
  'eu-ib:34,-10,45,5', 'eu-fr:45,-10,55,5', 'eu-uk:50,-11,60,2', 'eu-de:45,5,55,15',
  'eu-it:34,5,45,20', 'eu-sc:55,5,72,25', 'eu-gr:34,20,45,45', 'eu-pl:45,15,60,45', 'eu-at:34,-25,55,-10',
  'as-w:5,45,45,90', 'as-e1:40,90,82,140', 'as-e2:5,90,40,140', 'as-e3:5,140,82,180',
];

async function fetchWorld(dest: string): Promise<void> {
  process.stdout.write('Fetching world charging NODES from Overpass (several minutes)…\n');
  const nodes = await overpass('[out:json][timeout:800];node["amenity"="charging_station"];out body;');
  process.stdout.write(`  ${nodes.length} nodes; fetching ways + relations (areas), tiled…\n`);
  const areas = new Map<string, OsmElement>(); // dedup across overlapping tiles
  for (const tile of AREA_TILES) {
    const [name, box] = tile.split(':');
    try {
      const els = await overpass(
        `[out:json][timeout:170];(way["amenity"="charging_station"](${box});relation["amenity"="charging_station"](${box}););out tags center;`,
      );
      for (const el of els) areas.set(`${el.type}${el.id}`, el);
      process.stdout.write(`  areas ${name}: ${els.length}\n`);
    } catch (err) {
      process.stderr.write(`  areas ${name} failed (${(err as Error).message})\n`);
    }
  }
  writeFileSync(dest, JSON.stringify({ elements: [...nodes, ...areas.values()] }));
}

function loadChargers(path: string): StoredCharger[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return raw as StoredCharger[]; // already-mapped StoredCharger[]
  const els = (raw.elements ?? []) as OsmElement[]; // raw Overpass dump
  return els.map((el) => mapOsmElement(el)).filter((c): c is StoredCharger => c !== null);
}

function buildDb(chargers: StoredCharger[]): number {
  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath)) rmSync(outPath); // rebuild fresh so stale rows never linger

  const db = new DatabaseSync(outPath);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE chargers (
      id TEXT PRIMARY KEY, lat REAL NOT NULL, lng REAL NOT NULL,
      name TEXT, place TEXT, region TEXT, currentType TEXT, maxPowerKW REAL,
      totalConnectors INTEGER, connectors TEXT, phone TEXT, website TEXT, open247 INTEGER
    );
  `);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chargers
     (id, lat, lng, name, place, region, currentType, maxPowerKW, totalConnectors, connectors, phone, website, open247)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  let n = 0;
  for (const c of chargers) {
    insert.run(
      c.id, c.latitude, c.longitude, c.name, c.place, c.region, c.currentType, c.maxPowerKW,
      c.totalConnectors, JSON.stringify(c.connectors), c.phone ?? null, c.website ?? null,
      c.openingHours && c.openingHours.length ? 1 : 0,
    );
    n += 1;
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_chargers_lat ON chargers(lat)'); // narrows the bbox query; lng filtered in-range
  db.exec('VACUUM');
  db.close();
  return n;
}

async function main() {
  let inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('usage: build-charger-db.ts <--world | input.json> [out.db]\n');
    process.exit(1);
  }
  if (inputPath === '--world') {
    inputPath = join(HERE, 'out/world.json');
    mkdirSync(dirname(inputPath), { recursive: true });
    await fetchWorld(inputPath);
  }
  const chargers = loadChargers(inputPath);
  process.stdout.write(`Loaded ${chargers.length} chargers from ${inputPath}\n`);
  const n = buildDb(chargers);
  const { size } = statSync(outPath);
  process.stdout.write(`Wrote ${n} rows → ${outPath} (${(size / 1e6).toFixed(1)} MB)\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
