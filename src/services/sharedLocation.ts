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

const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Build a validated coordinate; swap if "lat" is out of range but "lng" is a valid latitude; else null.
function validCoord(latRaw: number, lngRaw: number): LatLng | null {
  let lat = latRaw;
  let lng = lngRaw;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) { const t = lat; lat = lng; lng = t; }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

// Parse a "lat,lng" string into a validated coordinate, or null if it isn't a coordinate pair.
function parseLatLng(s: string | null | undefined): LatLng | null {
  if (!s) return null;
  const m = s.match(LATLNG_RE);
  return m ? validCoord(parseFloat(m[1]), parseFloat(m[2])) : null;
}

function hostSource(host: string): ShareSource {
  if (host.includes('waze.com')) return 'waze';
  if (host.includes('apple')) return 'apple'; // maps.apple.com AND the maps.apple/p short-link domain
  if (host.includes('google.') || host.includes('goo.gl') || host.includes('g.co')) return 'google';
  return 'unknown';
}

export function extractFromUrl(url: string): RawExtract | null {
  let u: URL;
  try { u = new URL(url.trim().replace(/^http:/, 'https:')); } catch { return null; }
  const source = hostSource(u.hostname);
  if (source === 'unknown') return null;
  const qp = u.searchParams;
  const decoded = safeDecode(url);

  // Google EU consent interstitial (consent.google.com/ml?continue=… or /sorry) wraps the real maps URL in
  // the `continue` param — unwrap it and re-extract from that.
  if (u.hostname.includes('consent.google') || u.pathname.startsWith('/sorry')) {
    const cont = qp.get('continue');
    if (cont) return extractFromUrl(cont);
  }

  if (source === 'apple') {
    const coord = parseLatLng(qp.get('ll')) ?? parseLatLng(qp.get('coordinate'));
    const qCoord = parseLatLng(qp.get('q'));
    const label = (qCoord ? undefined : qp.get('q')) ?? qp.get('name') ?? undefined;
    return { source, coordinate: coord ?? qCoord ?? undefined, name: label?.trim(), address: qp.get('address') ?? undefined };
  }

  if (source === 'waze') {
    // /ul/h<geohash>
    const gh = u.pathname.match(/\/ul\/h([0-9bcdefghjkmnpqrstuvwxyz]+)/i);
    if (gh) return { source, coordinate: decodeGeohash(gh[1]) };
    // to=ll.LAT,LNG  |  ll=LAT,LNG
    const to = qp.get('to');
    const toCoord = to && to.startsWith('ll.') ? parseLatLng(to.slice(3)) : null;
    const coord = parseLatLng(qp.get('ll')) ?? toCoord;
    return coord ? { source, coordinate: coord } : { source };
  }

  // google
  const d = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/); // the real place pin
  const at = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/); // camera fallback
  const qCoord = parseLatLng(qp.get('q')) ?? parseLatLng(qp.get('query')) ?? parseLatLng(qp.get('ll'));
  const coord =
    (d ? validCoord(parseFloat(d[1]), parseFloat(d[2])) : null) ??
    qCoord ??
    (at ? validCoord(parseFloat(at[1]), parseFloat(at[2])) : null);
  const placeSeg = u.pathname.match(/\/place\/([^/@]+)/);
  const name = placeSeg ? safeDecode(placeSeg[1]).replace(/\+/g, ' ') : undefined;
  // A q=/query= NAME (not coordinates) — e.g. from a resolved goo.gl share that only carries a place name +
  // feature-id — becomes the geocode address so parseSharedLocation's fallback can turn it into a point.
  const qName = !qCoord ? (qp.get('q') ?? qp.get('query') ?? undefined)?.trim() : undefined;
  return {
    source,
    coordinate: coord ?? undefined,
    name: name ?? qName ?? undefined,
    address: coord ? undefined : qName,
  };
}

export interface ParseDeps {
  resolveUrl: (url: string) => Promise<{ finalUrl: string; body: string } | null>;
  geocode: (address: string) => Promise<LatLng | null>;
}

// Short links that carry no coords and must be resolved: Google (maps.app.goo.gl / goo.gl/maps / g.co) and
// Apple's newer maps.apple/p/<id> (redirects to maps.apple.com/place?coordinate=…).
const SHORT_LINK_RE = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.apple\/p)/i;

export function firstUrl(raw: string): string | null {
  const m = raw.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

export function isShortLink(url: string): boolean {
  return SHORT_LINK_RE.test(url);
}

function toShared(r: RawExtract | null): SharedLocation | null {
  return r && r.coordinate ? { coordinate: r.coordinate, name: r.name, source: r.source } : null;
}

export async function parseSharedLocation(raw: string, deps: ParseDeps): Promise<SharedLocation | null> {
  const url = firstUrl(raw);
  if (!url) return null;

  // 1) Direct extraction.
  let extract = extractFromUrl(url);
  let coordHit = toShared(extract);
  if (coordHit) return coordHit;

  // 2) Short link → resolve, then re-extract over the final URL AND the HTML body.
  if (isShortLink(url)) {
    const resolved = await deps.resolveUrl(url);
    if (resolved) {
      coordHit = toShared(extractFromUrl(resolved.finalUrl));
      if (coordHit) return coordHit;
      // Some links land on a consent interstitial that carries the coords only in the body.
      const body = resolved.body;
      const d = body.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || body.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (d) {
        const lat = parseFloat(d[1]);
        const lng = parseFloat(d[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
          return { coordinate: { latitude: lat, longitude: lng }, source: 'google' };
        }
      }
      extract = extractFromUrl(resolved.finalUrl) ?? extract;
    }
  }

  // 3) Address-only → geocode.
  const address = extract?.address;
  if (address) {
    const c = await deps.geocode(address);
    if (c) return { coordinate: c, name: extract?.name, source: extract?.source ?? 'unknown' };
  }
  return null;
}
