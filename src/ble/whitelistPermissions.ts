// whitelistPermissions.ts — read the car's per-key permission list.
//
// WHY THIS IS HAND-ROLLED. The passive-entry research
// (docs/superpowers/research/phone-key-authorization-and-passive-entry.md §1.3)
// establishes that walk-up unlock is authorized by WHITELISTKEYPERMISSION_LOCAL_UNLOCK(1),
// which the car derives from our ROLE_DRIVER enrollment. That expansion lives in
// VCSEC firmware and is the ONE thing static RE can't answer (§1.4) — it has to
// be read off the car.
//
// The blocker: our vendored proto's VCSEC.WhitelistEntryInfo does NOT model the
// `permissions` field (field 3) at all, and there is no WhitelistKeyPermission
// enum in gen.js. Verified empirically: decoding a WhitelistEntryInfo carrying
// field 3 returns keyRole fine and silently DROPS the permissions — and
// `$unknowns` is not populated in this build, so unknown-field preservation
// can't recover it either. Regenerating the whole 60k-line gen.js to add one
// field is disproportionate, so we scan the wire bytes for exactly that field.
// (Same reasoning as the Pi's hand-rolled RoutableMessage field scanner.)
//
// Pure — no imports, no I/O — so it is fully node-testable against hand-built
// frames.

// From the research doc §3.3 (VCSEC.WhitelistKeyPermission).
export const WHITELIST_PERMISSION_NAMES: Record<number, string> = {
  0: 'ADD_TO_WHITELIST',
  1: 'LOCAL_UNLOCK',
  2: 'LOCAL_DRIVE',
  3: 'REMOTE_UNLOCK',
  4: 'REMOTE_DRIVE',
  5: 'CHANGE_PERMISSIONS',
  6: 'REMOVE_FROM_WHITELIST',
  7: 'REMOVE_SELF',
  8: 'MODIFY_FLEET_RESERVED_SLOTS',
  31: 'UNKNOWN',
};

// The permission that authorizes walk-up/passive unlock (§1.3). There is no
// dedicated "passive" bit — this is the one.
export const PERMISSION_LOCAL_UNLOCK = 1;

// Wire layout we care about:
//   FromVCSECMessage.whitelistEntryInfo = field 17 (LEN)
//     WhitelistEntryInfo.permissions    = field 3  (repeated enum)
const FIELD_WHITELIST_ENTRY_INFO = 17;
const FIELD_PERMISSIONS = 3;

interface Cursor {
  buf: Uint8Array;
  pos: number;
}

// readVarint reads a base-128 varint. Returns null on a truncated/oversized
// value rather than throwing — this parses bytes off a car, so a malformed
// frame must degrade to "unknown", never crash the caller.
function readVarint(c: Cursor): number | null {
  let result = 0;
  let shift = 0;
  while (c.pos < c.buf.length) {
    const byte = c.buf[c.pos];
    c.pos += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 35) return null; // beyond a 32-bit field — malformed
  }
  return null; // truncated
}

// skipField advances past one field's payload given its wire type. Returns
// false if the field is unparseable (caller then abandons the scan).
function skipField(c: Cursor, wireType: number): boolean {
  switch (wireType) {
    case 0: // varint
      return readVarint(c) !== null;
    case 1: // 64-bit
      c.pos += 8;
      return c.pos <= c.buf.length;
    case 2: {
      // length-delimited
      const len = readVarint(c);
      if (len === null) return false;
      c.pos += len;
      return c.pos <= c.buf.length;
    }
    case 5: // 32-bit
      c.pos += 4;
      return c.pos <= c.buf.length;
    default:
      return false; // groups (3/4) don't appear in these messages
  }
}

// findSubMessage returns the raw bytes of the first top-level field matching
// `fieldNumber` with wire type 2, or null.
function findSubMessage(buf: Uint8Array, fieldNumber: number): Uint8Array | null {
  const c: Cursor = { buf, pos: 0 };
  while (c.pos < buf.length) {
    const tag = readVarint(c);
    if (tag === null) return null;
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (field === fieldNumber && wireType === 2) {
      const len = readVarint(c);
      if (len === null || c.pos + len > buf.length) return null;
      return buf.subarray(c.pos, c.pos + len);
    }
    if (!skipField(c, wireType)) return null;
  }
  return null;
}

// collectRepeatedEnum gathers every value of a repeated enum field, accepting
// BOTH encodings: packed (wire type 2, a run of varints) and unpacked (wire
// type 0, the field repeated). proto3 emits packed by default, but a repeated
// enum is legal either way and we don't control the car's encoder — so accept
// both rather than guess which this firmware uses.
function collectRepeatedEnum(buf: Uint8Array, fieldNumber: number): number[] | null {
  const out: number[] = [];
  let sawField = false;
  const c: Cursor = { buf, pos: 0 };
  while (c.pos < buf.length) {
    const tag = readVarint(c);
    if (tag === null) return sawField ? out : null;
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (field === fieldNumber && wireType === 0) {
      sawField = true;
      const v = readVarint(c);
      if (v === null) return out;
      out.push(v);
      continue;
    }
    if (field === fieldNumber && wireType === 2) {
      sawField = true;
      const len = readVarint(c);
      if (len === null || c.pos + len > buf.length) return out;
      const inner: Cursor = { buf: buf.subarray(c.pos, c.pos + len), pos: 0 };
      while (inner.pos < inner.buf.length) {
        const v = readVarint(inner);
        if (v === null) break;
        out.push(v);
      }
      c.pos += len;
      continue;
    }
    if (!skipField(c, wireType)) return sawField ? out : null;
  }
  return sawField ? out : null;
}

// parseWhitelistPermissions extracts the permission list from a decrypted
// FromVCSECMessage payload.
//
// Returns:
//   • number[] — the permissions the car reports (possibly EMPTY, which is
//     meaningful: per §3.3 an unset repeated enum decodes to ADD_TO_WHITELIST(0),
//     so "present but empty" and "contains 0" are NOT the same claim).
//   • null    — no whitelistEntryInfo in this message, or no permissions field
//     on it. Explicitly "we don't know", never silently "[]".
export function parseWhitelistPermissions(fromVcsecPayload: Uint8Array): number[] | null {
  const entry = findSubMessage(fromVcsecPayload, FIELD_WHITELIST_ENTRY_INFO);
  if (!entry) return null;
  return collectRepeatedEnum(entry, FIELD_PERMISSIONS);
}

export function permissionName(value: number): string {
  return WHITELIST_PERMISSION_NAMES[value] ?? `unknown(${value})`;
}

// hasLocalUnlock answers the actual question: is this key passive-entry
// eligible on this car's firmware? null in → null out (unknown ≠ false).
export function hasLocalUnlock(permissions: number[] | null): boolean | null {
  if (permissions === null) return null;
  return permissions.includes(PERMISSION_LOCAL_UNLOCK);
}

// describeWhitelistPermissions renders the probe result for the on-device
// diagnostics log.
export function describeWhitelistPermissions(permissions: number[] | null): string {
  if (permissions === null) {
    return 'permissions: UNKNOWN (car sent no whitelistEntryInfo/permissions field)';
  }
  if (permissions.length === 0) {
    return 'permissions: [] (empty — car reported the entry with NO permission bits)';
  }
  const names = permissions.map((p) => `${permissionName(p)}(${p})`).join(', ');
  const verdict = permissions.includes(PERMISSION_LOCAL_UNLOCK)
    ? 'LOCAL_UNLOCK present → passive-entry ELIGIBLE'
    : 'LOCAL_UNLOCK ABSENT → walk-up unlock would NOT be authorized';
  return `permissions: [${names}] → ${verdict}`;
}

// --- Slot enumeration + raw diagnostics (whitelist-probe plan, Tasks 1-2) ----
//
// Added to enable a CONTROL-GROUP experiment. Our own entry comes back with no
// permissions field; the firmware RE says VCSEC materializes permissions[] into
// WhitelistEntryInfo. Both can't be right — so enumerate EVERY filled slot and
// compare our entry against the car's other keys (the official Tesla phone key,
// the NFC card). If theirs carry permissions and ours doesn't, that is a real
// finding about OUR enrollment. If nobody's does, the BLE reply simply omits them.

const FIELD_WHITELIST_INFO = 16;
const FIELD_NUMBER_OF_ENTRIES = 1;
const FIELD_SLOT_MASK = 3;
const FIELD_ENTRY_PUBLIC_KEY = 2;

// parseWhitelistInfo pulls numberOfEntries + slotMask out of a FromVCSECMessage
// carrying whitelistInfo (field 16). null if that submessage is absent.
export function parseWhitelistInfo(
  fromVcsecPayload: Uint8Array,
): { numberOfEntries: number; slotMask: number } | null {
  const info = findSubMessage(fromVcsecPayload, FIELD_WHITELIST_INFO);
  if (!info) return null;
  let numberOfEntries = 0;
  let slotMask = 0;
  const c: Cursor = { buf: info, pos: 0 };
  while (c.pos < info.length) {
    const tag = readVarint(c);
    if (tag === null) break;
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (field === FIELD_NUMBER_OF_ENTRIES && wireType === 0) {
      const v = readVarint(c);
      if (v === null) break;
      numberOfEntries = v;
      continue;
    }
    if (field === FIELD_SLOT_MASK && wireType === 0) {
      const v = readVarint(c);
      if (v === null) break;
      slotMask = v;
      continue;
    }
    if (!skipField(c, wireType)) break;
  }
  return { numberOfEntries, slotMask };
}

// filledSlots expands a slotMask bitfield into the set slot indices.
export function filledSlots(slotMask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    if ((slotMask & (1 << i)) !== 0) out.push(i);
  }
  return out;
}

// parseWhitelistEntryPublicKey returns the entry's publicKey bytes. We identify
// OUR slot by matching this against our own key rather than by keyId: the car
// truncates keyIds (proven on-car — a full-SHA1 target faulted DECODING while a
// 4-byte one worked), so a pubkey match is unambiguous where a keyId match is not.
//
// WhitelistEntryInfo.publicKey is a PublicKey MESSAGE wrapping the raw point in
// its own field 1, so unwrap one more level when present.
export function parseWhitelistEntryPublicKey(fromVcsecPayload: Uint8Array): Uint8Array | null {
  const entry = findSubMessage(fromVcsecPayload, FIELD_WHITELIST_ENTRY_INFO);
  if (!entry) return null;
  const pk = findSubMessage(entry, FIELD_ENTRY_PUBLIC_KEY);
  if (!pk) return null;
  const inner = findSubMessage(pk, 1);
  return inner ?? pk;
}

// dumpTopLevelFields enumerates every top-level field so a reply can be read
// even when we have no proto for it — "which submessage did the car actually
// send?" is usually the decisive clue.
export function dumpTopLevelFields(
  payload: Uint8Array,
): Array<{ field: number; wireType: number; length: number }> {
  const out: Array<{ field: number; wireType: number; length: number }> = [];
  const c: Cursor = { buf: payload, pos: 0 };
  while (c.pos < payload.length) {
    const tag = readVarint(c);
    if (tag === null) break;
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    let length = 0;
    if (wireType === 2) {
      const len = readVarint(c);
      if (len === null) break;
      length = len;
      c.pos += len;
    } else if (!skipField(c, wireType)) {
      break;
    }
    out.push({ field, wireType, length });
  }
  return out;
}

// dumpEntryFields does the same one level in, for the WhitelistEntryInfo body —
// this is what tells us whether field 3 (permissions) is present on ANY key.
export function dumpEntryFields(
  fromVcsecPayload: Uint8Array,
): Array<{ field: number; wireType: number; length: number }> | null {
  const entry = findSubMessage(fromVcsecPayload, FIELD_WHITELIST_ENTRY_INFO);
  if (!entry) return null;
  return dumpTopLevelFields(entry);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
