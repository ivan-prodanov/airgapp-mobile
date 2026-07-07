import { distanceMeters, offsetCoordinate, type LatLng } from '@/state/mockLocation';

// A charging station, normalised from TomTom's Search result (or the mock). Fields the Charging UI needs:
// title/place for the row, current type + power for the AC/DC filter, availability for the badge +
// "available only" filter, and price for the price sort (best-effort — TomTom rarely returns price).
export interface Charger {
  id: string;
  name: string; // e.g. "Tesla Supercharger"
  place: string; // e.g. "Paradise Center"
  region: string; // e.g. "Sofia, Bulgaria"
  latitude: number;
  longitude: number;
  currentType: 'AC' | 'DC';
  maxPowerKW: number;
  totalConnectors: number;
  availableConnectors: number;
  pricePerKWh?: number; // in EUR (TomTom rarely provides this; usually mock-only)
  // Connector plugs grouped by type + power + AC/DC (e.g. "2× CCS 200 kW DC"). From chargingPark.
  connectors: ConnectorGroup[];
  phone?: string; // poi.phone
  website?: string; // poi.url
  openingHours?: OpeningRange[]; // poi.openingHours (needs openingHours=nextSevenDays on the query)
  // TomTom's live-availability handle, present only for stations with real-time data. Used to look up the
  // EV Charging Stations Availability API on demand (never persisted).
  availabilityId?: string;
  distanceM: number; // filled relative to the car by the caller
}

export interface ConnectorGroup {
  label: string; // friendly type, e.g. "CCS", "Type 2", "CHAdeMO"
  powerKW: number;
  currentType: 'AC' | 'DC';
  count: number;
}

export interface OpeningRange {
  startDate: string; // "YYYY-MM-DD"
  startHour: number;
  startMinute: number;
  endDate: string;
  endHour: number;
  endMinute: number;
}

// Real-time availability for one station, summed across its connectors.
export interface StationAvailability {
  available: number;
  total: number;
}

// Fetch live availability for a station by its TomTom chargingAvailability id (~3-min fresh data). Call
// on demand for visible/tapped stations only — each call is a billed transaction. Never persist the result.
export async function fetchAvailability(id: string): Promise<StationAvailability | null> {
  if (!TOMTOM_KEY) return null; // mock has no live availability
  try {
    const res = await fetch(`https://api.tomtom.com/search/2/chargingAvailability.json?key=${TOMTOM_KEY}&chargingAvailability=${id}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      connectors?: { total?: number; availability?: { current?: { available?: number } } }[];
    };
    let available = 0;
    let total = 0;
    for (const c of json.connectors ?? []) {
      total += c.total ?? 0;
      available += c.availability?.current?.available ?? 0;
    }
    return { available, total };
  } catch {
    return null;
  }
}

export interface ViewportRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// TomTom key is inlined by Metro at bundle time from EXPO_PUBLIC_TOMTOM_API_KEY, so it ships via the
// JS-only deploy (no native rebuild). Without a key, searchChargersInBounds() returns the mock set below.
const TOMTOM_KEY = process.env.EXPO_PUBLIC_TOMTOM_API_KEY ?? '';
const EV_CATEGORY = 7309; // TomTom POI category id: "Electric Vehicle Station"

// Build a native-maps navigation deep link target for a charger (reused by tap-to-navigate).
export function chargerCoord(c: Charger): LatLng {
  return { latitude: c.latitude, longitude: c.longitude };
}

// Pin/row COLOUR: DC = red whose brightness scales with power (full #E5484D at ≥200 kW, paler below);
// AC = grey. A per-station encoding — the reason we render individual pins, not clusters.
const DC_FULL = { r: 229, g: 72, b: 77 }; // #E5484D at ≥200 kW
export function pinColor(currentType: 'AC' | 'DC', maxPowerKW: number): string {
  if (currentType === 'AC') return '#8A8A8E';
  const t = Math.max(0.3, Math.min(1, maxPowerKW / 200)); // ≥200 kW → full red; floor keeps it readable
  const paleness = (1 - t) * 0.6; // lower power → blend further toward white (paler red)
  const mix = (c: number) => Math.round(c + (255 - c) * paleness);
  return `rgb(${mix(DC_FULL.r)}, ${mix(DC_FULL.g)}, ${mix(DC_FULL.b)})`;
}

// What a pin/row badge shows: the connector count (empty when unknown → just the bolt). `color` encodes
// DC/AC + power. No live-availability "?" — we have no live source, so the number is the static connector count.
export interface ChargerBadge {
  text: string;
  color: string;
}
export function chargerBadge(c: Charger): ChargerBadge {
  return { text: c.totalConnectors > 0 ? String(c.totalConnectors) : '', color: pinColor(c.currentType, c.maxPowerKW) };
}

// Runtime (JS-only) Tesla-Supercharger detection from the OSM-derived fields: the name (Tesla's trademark
// "Supercharger" — the strongest, most-consistent signal) or a Tesla supercharger connector. Note "Tesla
// (AC)" (Destination chargers) is deliberately excluded.
export function isTeslaSupercharger(c: Charger): boolean {
  return /supercharger/i.test(c.name) || c.connectors.some((g) => g.label === 'Tesla' || g.label === 'Tesla CCS');
}

// Priority for draw order AND for resolving which of several OVERLAPPING pins a tap selects: Tesla
// Superchargers first, then DC (by power), then AC (by power). iOS ignores zIndex for hit-testing, so the
// tap handler picks the highest-priority pin near the tap instead — this is what makes that work.
export function chargerPriority(c: Charger): number {
  const tier = isTeslaSupercharger(c) ? 3_000_000 : c.currentType === 'DC' ? 2_000_000 : 1_000_000;
  return tier + c.maxPowerKW;
}

// The n/s/e/w edges of a region (centre ± half-delta) — used for the viewport fetch bbox + in-view filter.
export function boundsForRegion(region: ViewportRegion): LatLngBounds {
  return {
    north: region.latitude + region.latitudeDelta / 2,
    south: region.latitude - region.latitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
    west: region.longitude - region.longitudeDelta / 2,
  };
}

// Search EV stations INSIDE a map bounding box via TomTom geometrySearch (POST POLYGON) — returns stations
// spread across the whole rectangle, not just nearest-to-centre. Sorted by distance from the car. These are
// STATIC POI fields only; live availability is a separate on-demand call (EV Availability API, v2) and must
// never be persisted. The fetched set is a transient, in-memory, per-session cache (ToS-compliant).
// Result of a bounds search. `quotaExceeded` is true when TomTom refused the request because the daily
// free allowance / credit balance is spent (HTTP 403 InsufficientFunds or 429) — the UI shows a notice.
export interface ChargerSearchResult {
  chargers: Charger[];
  quotaExceeded: boolean;
}

export async function searchChargersInBounds(bounds: LatLngBounds, car: LatLng): Promise<ChargerSearchResult> {
  const res = TOMTOM_KEY
    ? await fetchTomTomBounds(bounds)
    : { chargers: mockChargersInBounds(bounds), quotaExceeded: false };
  const chargers = res.chargers
    .map((c) => ({ ...c, distanceM: distanceMeters(car, c) }))
    .sort((a, b) => a.distanceM - b.distanceM);
  return { chargers, quotaExceeded: res.quotaExceeded };
}

async function fetchTomTomBounds(b: LatLngBounds): Promise<ChargerSearchResult> {
  const body = JSON.stringify({
    geometryList: [
      {
        type: 'POLYGON',
        vertices: [`${b.north},${b.west}`, `${b.north},${b.east}`, `${b.south},${b.east}`, `${b.south},${b.west}`],
      },
    ],
  });
  try {
    const res = await fetch(
      `https://api.tomtom.com/search/2/geometrySearch/.json?key=${TOMTOM_KEY}&categorySet=${EV_CATEGORY}&limit=100&openingHours=nextSevenDays`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    );
    if (!res.ok) {
      // 429 = daily request limit; 403 = credit balance spent (InsufficientFunds). Both mean "out of quota".
      return { chargers: [], quotaExceeded: res.status === 403 || res.status === 429 };
    }
    const json = (await res.json()) as { results?: TomTomResult[] };
    const chargers = (json.results ?? []).map(mapTomTomResult).filter((c): c is Charger => c !== null);
    return { chargers, quotaExceeded: false };
  } catch {
    return { chargers: [], quotaExceeded: false };
  }
}

interface RawConnector {
  connectorType?: string;
  ratedPowerKW?: number;
  currentType?: string;
}
interface TomTomTimeRange {
  startTime: { date: string; hour: number; minute: number };
  endTime: { date: string; hour: number; minute: number };
}
interface TomTomResult {
  id?: string;
  poi?: { name?: string; phone?: string; url?: string; openingHours?: { timeRanges?: TomTomTimeRange[] } };
  address?: { freeformAddress?: string; municipality?: string; country?: string };
  position?: { lat: number; lon: number };
  chargingPark?: { connectors?: RawConnector[] };
  dataSources?: { chargingAvailability?: { id?: string } };
}

// TomTom connectorType → friendly label.
const CONNECTOR_LABELS: Record<string, string> = {
  IEC62196Type2CCS: 'CCS',
  IEC62196Type1CCS: 'CCS (Type 1)',
  IEC62196Type2Outlet: 'Type 2',
  IEC62196Type2CableAttached: 'Type 2',
  IEC62196Type1: 'Type 1',
  IEC62196Type3: 'Type 3',
  Chademo: 'CHAdeMO',
  Tesla: 'Tesla',
  StandardHouseholdCountrySpecific: 'Domestic',
  GBT20234Part2: 'GB/T DC',
  GBT20234Part3: 'GB/T AC',
};
function connectorLabel(type: string): string {
  return CONNECTOR_LABELS[type] ?? type.replace(/^IEC\d+/i, '').replace(/Type2?/i, 'Type ') ?? 'Connector';
}
function connectorCurrent(c: RawConnector): 'AC' | 'DC' {
  return (c.currentType ?? '').includes('DC') || (c.ratedPowerKW ?? 0) >= 43 ? 'DC' : 'AC';
}
// Group identical plugs (same label + power + current) into counted rows, strongest first.
function groupConnectors(raw: RawConnector[]): ConnectorGroup[] {
  const map = new Map<string, ConnectorGroup>();
  for (const c of raw) {
    const label = connectorLabel(c.connectorType ?? '');
    const powerKW = c.ratedPowerKW ?? 0;
    const currentType = connectorCurrent(c);
    const key = `${label}|${powerKW}|${currentType}`;
    const g = map.get(key);
    if (g) g.count += 1;
    else map.set(key, { label, powerKW, currentType, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.powerKW - a.powerKW);
}
function parseOpeningHours(tr?: TomTomTimeRange[]): OpeningRange[] | undefined {
  if (!tr || tr.length === 0) return undefined;
  return tr.map((t) => ({
    startDate: t.startTime.date,
    startHour: t.startTime.hour,
    startMinute: t.startTime.minute,
    endDate: t.endTime.date,
    endHour: t.endTime.hour,
    endMinute: t.endTime.minute,
  }));
}

function mapTomTomResult(r: TomTomResult): Charger | null {
  const pos = r.position;
  if (!pos) return null;
  const connectors = r.chargingPark?.connectors ?? [];
  const powers = connectors.map((c) => c.ratedPowerKW ?? 0);
  const isDC = connectors.some((c) => connectorCurrent(c) === 'DC');
  const region = [r.address?.municipality, r.address?.country].filter(Boolean).join(', ');
  return {
    id: String(r.id ?? `${pos.lat},${pos.lon}`),
    name: r.poi?.name ?? 'Charging station',
    place: r.address?.freeformAddress ?? region,
    region: region || 'Nearby',
    latitude: pos.lat,
    longitude: pos.lon,
    currentType: isDC ? 'DC' : 'AC',
    maxPowerKW: powers.length ? Math.max(...powers) : isDC ? 50 : 22,
    // Connector count from Search (0 = TomTom has no connector metadata → "unknown", NOT "1"). Live
    // availability is a separate call (EV Availability API); until then the badge shows this count.
    totalConnectors: connectors.length,
    availableConnectors: connectors.length,
    connectors: groupConnectors(connectors),
    phone: r.poi?.phone,
    website: r.poi?.url,
    openingHours: parseOpeningHours(r.poi?.openingHours?.timeRanges),
    availabilityId: r.dataSources?.chargingAvailability?.id,
    distanceM: 0,
  };
}

// Format opening hours for display: "Open 24 hours", "Today 8:00 AM – 8:00 PM", or "Closed today".
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function fmtTime(hour: number, minute: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return minute ? `${h12}:${pad2(minute)} ${suffix}` : `${h12} ${suffix}`;
}
export function formatOpeningHours(ranges: OpeningRange[] | undefined): string | null {
  if (!ranges || ranges.length === 0) return null;
  if (ranges.length === 1) {
    const days = (Date.parse(ranges[0].endDate) - Date.parse(ranges[0].startDate)) / 86_400_000;
    if (days >= 6) return 'Open 24 hours';
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const todays = ranges.filter((r) => r.startDate === today);
  if (todays.length === 0) return 'Closed today';
  return `Today ${todays.map((r) => `${fmtTime(r.startHour, r.startMinute)} – ${fmtTime(r.endHour, r.endMinute)}`).join(', ')}`;
}

// --- Mock fallback (without a key): ~36 stations scattered on 3 rings around the first-queried centre (the
// car), so the map is well populated. searchChargersInBounds filters them to the requested bbox.
let mockAnchor: LatLng | null = null;
let mockSet: Charger[] | null = null;
const MOCK_NAMES = ['Tesla Supercharger', 'Ionity', 'Eldrive', 'Shell Recharge', 'AMP Charge', 'PowerGo'];

function ensureMockSet(center: LatLng): Charger[] {
  if (mockAnchor && mockSet) return mockSet;
  mockAnchor = center;
  const set: Charger[] = [];
  let i = 0;
  for (const dist of [2000, 5000, 9000]) {
    for (let bearing = 0; bearing < 360; bearing += 30) {
      const coord = offsetCoordinate(center, { bearingDeg: bearing, distanceM: dist });
      const dc = i % 2 === 0;
      const power = dc ? [50, 120, 250][i % 3] : [7, 11, 22][i % 3];
      const total = (i % 6) + 1;
      set.push({
        id: `mock-${i}`,
        name: MOCK_NAMES[i % MOCK_NAMES.length],
        place: 'Sofia',
        region: 'Sofia, Bulgaria',
        latitude: coord.latitude,
        longitude: coord.longitude,
        currentType: dc ? 'DC' : 'AC',
        maxPowerKW: power,
        totalConnectors: total,
        availableConnectors: i % 4,
        pricePerKWh: 0.3 + (i % 5) * 0.1,
        connectors: [{ label: dc ? 'CCS' : 'Type 2', powerKW: power, currentType: dc ? 'DC' : 'AC', count: total }],
        phone: '+359 2 400 0000',
        website: 'https://example.com',
        // A single 7-day-spanning range → "Open 24 hours".
        openingHours: [{ startDate: '2026-01-01', startHour: 0, startMinute: 0, endDate: '2026-01-08', endHour: 0, endMinute: 0 }],
        distanceM: 0,
      });
      i += 1;
    }
  }
  mockSet = set;
  return set;
}

function mockChargersInBounds(b: LatLngBounds): Charger[] {
  const center = { latitude: (b.north + b.south) / 2, longitude: (b.east + b.west) / 2 };
  return ensureMockSet(center).filter(
    (c) => c.latitude <= b.north && c.latitude >= b.south && c.longitude <= b.east && c.longitude >= b.west,
  );
}
