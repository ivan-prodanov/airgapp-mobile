/**
 * Build the bundled gazetteer SQLite database from GeoNames cities1000 (CC BY 4.0).
 *
 *   npx tsx scripts/geonames/build-places-db.ts            # download + build → assets/places.db
 *   npx tsx scripts/geonames/build-places-db.ts <out.db>   # custom output path
 *
 * Downloads cities1000.zip (~11 MB), unzips (system `unzip`), maps each line via mapGeoNamesRow, and
 * writes a `places` table (indexed on asciiname + name) to assets/places.db (~16 MB, gitignored). That
 * asset is bundled into the .app by the Xcode build and opened at runtime via expo-sqlite's
 * importDatabaseFromAssetAsync (src/services/placeSource.ts). Uses Node's built-in node:sqlite (≥ 22.5).
 * Data credit: "© GeoNames (CC BY 4.0)".
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapGeoNamesRow, type PlaceRecord } from '../../src/services/gazetteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, 'out');
const OUT_DB = process.argv[2] ?? join(HERE, '../../assets/places.db');
const URL = 'https://download.geonames.org/export/dump/cities1000.zip';

async function download(dest: string): Promise<void> {
  process.stdout.write(`Downloading ${URL}…\n`);
  const res = await fetch(URL, { headers: { 'User-Agent': 'airgapp-places-db/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function loadRecords(txtPath: string): PlaceRecord[] {
  const lines = readFileSync(txtPath, 'utf8').split('\n');
  const out: PlaceRecord[] = [];
  for (const line of lines) {
    if (!line) continue;
    const r = mapGeoNamesRow(line);
    if (r) out.push(r);
  }
  return out;
}

function buildDb(records: PlaceRecord[]): number {
  mkdirSync(dirname(OUT_DB), { recursive: true });
  if (existsSync(OUT_DB)) rmSync(OUT_DB);
  const db = new DatabaseSync(OUT_DB);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE places (
      id TEXT PRIMARY KEY, name TEXT, asciiname TEXT, lat REAL, lng REAL,
      country TEXT, admin1 TEXT, population INTEGER
    );
  `);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO places (id, name, asciiname, lat, lng, country, admin1, population)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  let n = 0;
  for (const r of records) {
    insert.run(r.id, r.name, r.asciiname, r.lat, r.lng, r.country, r.admin1, r.population);
    n += 1;
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_places_asciiname ON places(asciiname)');
  db.exec('CREATE INDEX idx_places_name ON places(name)');
  db.exec('VACUUM');
  db.close();
  return n;
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const zip = join(WORK, 'cities1000.zip');
  await download(zip);
  execFileSync('unzip', ['-o', '-q', zip, '-d', WORK]); // → WORK/cities1000.txt
  const records = loadRecords(join(WORK, 'cities1000.txt'));
  process.stdout.write(`Loaded ${records.length} places\n`);
  const n = buildDb(records);
  const { size } = statSync(OUT_DB);
  process.stdout.write(`Wrote ${n} rows → ${OUT_DB} (${(size / 1e6).toFixed(1)} MB)\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
