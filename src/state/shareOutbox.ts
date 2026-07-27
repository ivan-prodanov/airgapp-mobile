// shareOutbox — the durable queue of places shared into the app but not yet
// accepted by the car.
//
// WHY A QUEUE AND NOT A SLOT. Today the Share Extension writes ONE App Group key
// that each share overwrites, and the app CLEARS it before anything is sent. Two
// live data-loss paths fall out of that:
//
//   • share two places before opening the app → the first is destroyed
//   • the send fails for any reason at all → the place is already gone
//
// The rule that fixes both, and the only invariant this module really has:
//
//   APPEND BEFORE ATTEMPTING. REMOVE ONLY ON A CAR-CONFIRMED ACCEPT.
//
// Everything else here is bookkeeping in service of that. A duplicate delivery is
// a mild annoyance; a silently dropped destination is the bug the user actually
// notices, so every ambiguous case resolves towards keeping the item.
//
// Pure: no React Native, no file system, no App Group. The caller owns the bytes
// and where they live, which is what makes this node-testable and lets the same
// logic serve both the Swift writer and the JS reader.

export type OutboxStatus =
  // Waiting to be sent, or waiting to be retried.
  | 'pending'
  // The CAR confirmed it. Terminal, and the only status that permits removal.
  | 'sent'
  // The car refused it on its merits. Terminal: a semantic refusal fails
  // identically forever, so retrying is just noise.
  | 'rejected';

export interface OutboxLocation {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  source?: string;
}

export interface OutboxItem {
  id: string;
  // When the place was SHARED, not when it was last tried. This is what makes a
  // week-old share detectable — see isStale. The extension already writes a `ts`
  // that nothing has ever read.
  ts: number;
  location: OutboxLocation;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
}

// A share older than this is not sent verbatim. Arriving at a destination you
// asked for last Tuesday is worse than being told it expired: the car would
// silently start routing somewhere you have long since forgotten asking about.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Hard cap so a broken send path cannot grow the file without bound. Oldest go
// first — a recent share is far more likely to still be wanted.
export const MAX_ITEMS = 50;

// parseOutbox is deliberately forgiving. It reads a file written by ANOTHER
// PROCESS, possibly a different app version, possibly mid-write. A malformed
// entry drops that entry; it never throws and never discards the whole queue,
// because throwing here would strand every pending place behind one bad record.
export function parseOutbox(raw: string | null | undefined): OutboxItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: OutboxItem[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const loc = e.location as Record<string, unknown> | undefined;
    const lat = typeof loc?.lat === 'number' ? loc.lat : undefined;
    const lng = typeof loc?.lng === 'number' ? loc.lng : undefined;
    if (lat === undefined || lng === undefined) continue; // no coordinate, nothing to send
    if (typeof e.id !== 'string' || !e.id) continue;

    // Optional fields are OMITTED when absent rather than set to undefined.
    // JSON.stringify drops undefined, so a parse that added the keys back would
    // not round-trip: strict deep-equality distinguishes an absent key from an
    // explicit undefined one, and these objects cross a process boundary and get
    // re-serialised, so "the shape I parsed equals the shape I was given" is
    // worth preserving.
    const location: OutboxLocation = { lat, lng };
    if (typeof loc?.name === 'string') location.name = loc.name;
    if (typeof loc?.address === 'string') location.address = loc.address;
    if (typeof loc?.source === 'string') location.source = loc.source;

    const parsedItem: OutboxItem = {
      id: e.id,
      ts: typeof e.ts === 'number' ? e.ts : 0,
      location,
      status: e.status === 'sent' || e.status === 'rejected' ? e.status : 'pending',
      attempts: typeof e.attempts === 'number' ? e.attempts : 0,
    };
    if (typeof e.lastError === 'string') parsedItem.lastError = e.lastError;
    out.push(parsedItem);
  }
  return out;
}

export function serializeOutbox(items: readonly OutboxItem[]): string {
  return JSON.stringify(items);
}

// appendShare adds a newly shared place. Returns a NEW array — callers write the
// result back, so a caller that forgets to persist loses the append rather than
// silently corrupting the queue.
//
// Deduplicates on id so a retried write from the extension cannot double-queue
// the same share.
export function appendShare(items: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  const withoutDupe = items.filter((i) => i.id !== item.id);
  const next = [...withoutDupe, item];
  // Trim oldest-first, but never drop something still pending in favour of a
  // terminal record — sent/rejected entries are only kept for the UI.
  if (next.length <= MAX_ITEMS) return next;
  const terminal = next.filter((i) => i.status !== 'pending');
  const pending = next.filter((i) => i.status === 'pending');
  const keepTerminal = Math.max(0, MAX_ITEMS - pending.length);
  return [...terminal.slice(terminal.length - keepTerminal), ...pending].slice(-MAX_ITEMS);
}

export function isStale(item: OutboxItem, now: number): boolean {
  return item.ts > 0 && now - item.ts > STALE_AFTER_MS;
}

// nextToSend returns the items worth attempting right now, oldest first. Skips
// terminal statuses and anything too old to send verbatim.
export function nextToSend(items: readonly OutboxItem[], now: number): OutboxItem[] {
  return items.filter((i) => i.status === 'pending' && !isStale(i, now)).sort((a, b) => a.ts - b.ts);
}

// markSent is the ONLY transition that makes an item removable. It requires the
// car's own confirmation, not a transport ACK — an ACK says the frame arrived,
// not that the car accepted the destination.
export function markSent(items: readonly OutboxItem[], id: string): OutboxItem[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const { lastError: _cleared, ...rest } = i; // drop the key, don't blank it
    return { ...rest, status: 'sent' as const };
  });
}

// markRejected records a refusal the car made on the destination's merits, with
// its own words. Terminal on purpose: the same request will be refused the same
// way forever, so retrying only hides the reason.
export function markRejected(items: readonly OutboxItem[], id: string, reason: string): OutboxItem[] {
  return items.map((i) =>
    i.id === id ? { ...i, status: 'rejected' as const, lastError: reason, attempts: i.attempts + 1 } : i,
  );
}

// recordFailure is for everything that is NOT the car saying no: unreachable,
// timed out, no session. Stays pending — these are exactly the conditions that
// clear on their own when you next approach the car.
export function recordFailure(items: readonly OutboxItem[], id: string, error: string): OutboxItem[] {
  return items.map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1, lastError: error } : i));
}

// forgetDelivered drops items the user no longer needs to see: confirmed sends,
// and anything stale enough to be irrelevant. Rejections are KEPT — the user
// should find out the car refused something, and silently dropping it is how a
// failed share becomes invisible.
export function forgetDelivered(items: readonly OutboxItem[], now: number): OutboxItem[] {
  return items.filter((i) => {
    if (i.status === 'sent') return false;
    if (i.status === 'pending' && isStale(i, now)) return false;
    return true;
  });
}

// makeItemId builds a stable id from the share's timestamp and coordinate, so the
// extension can retry its write without queueing the same place twice. Not a
// hash — legible in the log, which matters when the only view of a cross-process
// queue is a diagnostics file.
export function makeItemId(ts: number, lat: number, lng: number): string {
  return `${ts}-${lat.toFixed(5)},${lng.toFixed(5)}`;
}
