# VCSEC Whitelist-Permissions BLE Probe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make airgapp reliably read (or definitively rule out reading) the car's per-key whitelist **permission bits** over BLE, to confirm the enrolled `ROLE_DRIVER` key carries `LOCAL_UNLOCK` (= passive-entry eligible).

**Architecture:** The current probe targets the whitelist entry by `keyId`/`publicKey` and **gets nothing back** from the car. Firmware RE shows the car's entry lookup is **slot-index-based**, and airgapp never targets by slot nor asks for the whitelist slot map first. This plan adds a `GET_WHITELIST_INFO` step + a **slot** target arm, and — crucially — a **raw-reply field dump** so we can *see* what the car actually returns before claiming success. It is **diagnostic-first**: it may prove the car does not expose permissions over BLE at all, in which case we fall back to a behavioral unlock probe.

**Tech Stack:** TypeScript, React Native, `protobufjs` (vendored `gen.js`), hand-rolled protobuf wire-scanners (no proto regen), node test runner (same as `whitelistPermissions.test.ts`).

## Global Constraints

- **Do NOT regenerate `gen.js` / edit `proto/vcsec.proto`.** The vendored `WhitelistEntryInfo` is stripped (no `permissions` field 3, no `secondsEntryRemainsActive` field 5); we read those fields with a **raw wire-scanner** instead. This is an established pattern (`src/ble/whitelistPermissions.ts`, and the Pi's RoutableMessage scanner).
- **Air-gapped:** no Tesla cloud / OwnerAPI calls. BLE (or Pi-relayed BLE) only. `src/ble/no-tesla-servers.test.ts` fails the build on `tesla.com`/`owner-api` literals — do not add any.
- **`null` ≠ `[]`.** `null` = "car did not tell us" (unknown); `[]` = "car reported the entry with zero permission bits". Never collapse them.
- **Pure parsers stay pure** (no imports, no I/O) so they are node-testable against hand-built frames.
- All VCSEC actions set `FLAG_ENCRYPT_RESPONSE` (already done in `vcsecGetWhitelistEntryAction`).

---

## Background the implementer needs (zero-context)

**What airgapp does today:** enrolls its own phone key into the car's VCSEC whitelist with
`keyRole = ROLE_DRIVER` and an **empty** permission list, then sends commands over an authenticated
BLE session (ECDH → AES-GCM). The car (VCSEC ECU) expands the role into concrete permission bits. We
want to confirm the bit that authorizes walk-up/passive unlock — `WHITELISTKEYPERMISSION_LOCAL_UNLOCK`
— is present on our key.

**Why the current probe fails (root cause — verified, not guessed):**
1. It is **not a parser bug.** `src/ble/whitelistPermissions.ts` is a correct raw-byte scanner that
   already extracts `WhitelistEntryInfo.permissions` (field 3) regardless of the stripped proto.
2. `src/ble/session.ts:851-854` records the empirical on-car result: targeting by `publicKey`
   *"came back with **no whitelistEntryInfo at all**."* The car returns no entry, so there is nothing
   to parse.
3. Firmware RE (`~/Work/tesla-firmware/out/vcsec-phonekey-authz-firmware.md`): the VCSEC entry-read
   routine `GET_WHITELIST_ENTRY(0x701)` takes an **`INDEX` (slot)**, not a key. airgapp's
   `vcsecGetWhitelistEntryAction` only offers `keyId-sha1 | keyId-sha1-4 | publicKey` — **it never
   targets by slot**, and never calls `GET_WHITELIST_INFO` first to learn its slot. That is the most
   likely reason for "no entry."

**The honest caveat (read this before promising a result):** Even with correct slot-targeting, the car
may **not** include the permission bitmap in a BLE reply. Firmware evidence: Tesla's own diagnostic
reads permissions with a *separate* per-bit routine `GET_PERMISSION_FOR_KEY(0x705)` on the **UDS
diagnostic bus** — not inline in the whitelist entry, and not over BLE. So a BLE permissions read may be
**fundamentally unavailable**. This plan therefore instruments first (dump the raw reply), and only then
concludes. If permissions are unreadable over BLE, Task 6 (behavioral probe) answers the real question
another way.

### Reference facts (copy-paste correct)

Proto (`proto/vcsec.proto`):
```
enum InformationRequestType { GET_STATUS=0; GET_WHITELIST_INFO=5; GET_WHITELIST_ENTRY_INFO=6; }
message InformationRequest {
  InformationRequestType informationRequestType = 1;
  oneof key { KeyIdentifier keyId = 2; bytes publicKey = 3; uint32 slot = 4; }   // <-- slot=4 exists, unused today
}
message WhitelistInfo { uint32 numberOfEntries = 1; repeated KeyIdentifier whitelistEntries = 2; uint32 slotMask = 3; }
message KeyIdentifier { bytes publicKeySHA1 = 1; }
// WhitelistEntryInfo on the wire (real firmware) — airgapp's proto is MISSING fields 3 and 5:
//   keyId=1, publicKey=2, permissions[]=3 (repeated WhitelistKeyPermission), metadataForKey=4,
//   secondsEntryRemainsActive=5, slot=6, keyRole=7
// FromVCSECMessage submessage field numbers:
//   vehicleStatus=1, commandStatus=4, whitelistInfo=16, whitelistEntryInfo=17
```

`WhitelistKeyPermission` values: `ADD_TO_WHITELIST=0, LOCAL_UNLOCK=1, LOCAL_DRIVE=2, REMOTE_UNLOCK=3,
REMOTE_DRIVE=4, CHANGE_PERMISSIONS=5, REMOVE_FROM_WHITELIST=6, REMOVE_SELF=7,
MODIFY_FLEET_RESERVED_SLOTS=8, UNKNOWN=31`.

Whitelist model (firmware): **20 slots (0..19)**; **slot 0 is reserved** (the vehicle's own session
key); user keys occupy 1..19. `WhitelistInfo.slotMask` bit *i* set ⇒ slot *i* is filled.
`keyId = SHA1(publicKeyRaw)` (truncation ambiguous — do NOT rely on keyId matching; match on the full
65-byte `publicKey` returned per slot instead).

### Current code touch-points
- `src/ble/whitelistPermissions.ts` — pure scanner. Exports `parseWhitelistPermissions`,
  `hasLocalUnlock`, `describeWhitelistPermissions`, `PERMISSION_LOCAL_UNLOCK`,
  `WHITELIST_PERMISSION_NAMES`. Internal primitives: `readVarint`, `skipField`, `findSubMessage`,
  `collectRepeatedEnum`. **Reuse these primitives — do not duplicate varint logic.**
- `src/ble/session.ts:829-883` — `vcsecGetStatusAction`, `vcsecGetWhitelistEntryAction`,
  `WHITELIST_TARGET_MODES`, `WhitelistTargetMode`. `encodeVCSECMessage`, `DOMAIN_VEHICLE_SECURITY`,
  `FLAG_ENCRYPT_RESPONSE_BIT` live in this file.
- `src/ble/gateway.ts:420-475` — the probe orchestrator: loops `WHITELIST_TARGET_MODES`, sends each
  action, decrypts, calls `parseWhitelistPermissions`, builds a result `{ localUnlock, summary, slot }`.
- `src/ble/whitelistPermissions.test.ts` — existing test style (hand-built byte frames, node runtime).

---

## File Structure

- **Modify** `src/ble/whitelistPermissions.ts` — add pure helpers: `parseWhitelistInfo`,
  `filledSlots`, `parseWhitelistEntryPublicKey`, `dumpTopLevelFields`. (Reuses existing primitives; keep
  one file so the scanner primitives stay DRY.)
- **Modify** `src/ble/whitelistPermissions.test.ts` — tests for the four new pure helpers.
- **Modify** `src/ble/session.ts` — add `vcsecGetWhitelistInfoAction()`, add `'slot'` to
  `WhitelistTargetMode` + `WHITELIST_TARGET_MODES`, extend `vcsecGetWhitelistEntryAction` to accept a
  slot number.
- **Modify** `src/ble/gateway.ts` — new orchestration: `GET_WHITELIST_INFO` → resolve our slot(s) by
  per-slot pubkey match → read permissions; log the **raw reply hex + field map** for every attempt.
- **(Conditional) Create** `src/ble/localUnlockProbe.ts` + test — behavioral fallback (Task 6), only if
  Tasks 1–5 show permissions are not returned over BLE.

---

### Task 1: `parseWhitelistInfo` + `filledSlots` (pure)

Decode the `GET_WHITELIST_INFO` reply so we can enumerate which slots are filled.

**Files:**
- Modify: `src/ble/whitelistPermissions.ts`
- Test: `src/ble/whitelistPermissions.test.ts`

**Interfaces:**
- Consumes: existing internal `readVarint`, `findSubMessage` in the same file.
- Produces:
  - `parseWhitelistInfo(fromVcsecPayload: Uint8Array): { numberOfEntries: number; slotMask: number } | null`
  - `filledSlots(slotMask: number): number[]`

- [ ] **Step 1: Write the failing test**

```ts
// in whitelistPermissions.test.ts
import { parseWhitelistInfo, filledSlots } from './whitelistPermissions';

test('parseWhitelistInfo reads numberOfEntries + slotMask from field 16', () => {
  // FromVCSECMessage { whitelistInfo(16) = { numberOfEntries(1)=2, slotMask(3)=6 } }
  const frame = new Uint8Array([0x82, 0x01, 0x04, 0x08, 0x02, 0x18, 0x06]);
  expect(parseWhitelistInfo(frame)).toEqual({ numberOfEntries: 2, slotMask: 6 });
});

test('parseWhitelistInfo returns null when no whitelistInfo present', () => {
  expect(parseWhitelistInfo(new Uint8Array([0x08, 0x00]))).toBeNull();
});

test('filledSlots expands a slotMask bitfield to slot indices', () => {
  expect(filledSlots(6)).toEqual([1, 2]);      // bits 1,2
  expect(filledSlots(0)).toEqual([]);
  expect(filledSlots(1)).toEqual([0]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/ble/whitelistPermissions.test.ts` (use the repo's existing test command; check `package.json`)
Expected: FAIL — `parseWhitelistInfo is not a function`.

- [ ] **Step 3: Implement (append to `whitelistPermissions.ts`)**

```ts
const FIELD_WHITELIST_INFO = 16;
const FIELD_NUMBER_OF_ENTRIES = 1;
const FIELD_SLOT_MASK = 3;

// parseWhitelistInfo pulls numberOfEntries + slotMask out of a FromVCSECMessage
// carrying a whitelistInfo (field 16). Returns null if that submessage is absent.
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

// filledSlots expands a 32-bit slotMask into the list of set bit indices.
export function filledSlots(slotMask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    if ((slotMask & (1 << i)) !== 0) out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ble/whitelistPermissions.ts src/ble/whitelistPermissions.test.ts
git commit -m "feat(ble): decode WhitelistInfo slotMask for slot-targeted permission reads"
```

---

### Task 2: `parseWhitelistEntryPublicKey` + `dumpTopLevelFields` (pure)

We match our entry by its returned **public key** (keyId truncation is ambiguous), and we dump the raw
field map for diagnosis.

**Files:**
- Modify: `src/ble/whitelistPermissions.ts`
- Test: `src/ble/whitelistPermissions.test.ts`

**Interfaces:**
- Produces:
  - `parseWhitelistEntryPublicKey(fromVcsecPayload: Uint8Array): Uint8Array | null` — the entry's
    `publicKey` (field 2 of `WhitelistEntryInfo`, field 17).
  - `dumpTopLevelFields(payload: Uint8Array): Array<{ field: number; wireType: number; length: number }>`

- [ ] **Step 1: Write the failing test**

```ts
import { parseWhitelistEntryPublicKey, dumpTopLevelFields, parseWhitelistPermissions } from './whitelistPermissions';

test('parseWhitelistEntryPublicKey extracts field 2 of the whitelistEntryInfo', () => {
  // FromVCSECMessage { whitelistEntryInfo(17) = { publicKey(2)=04 AA BB, permissions(3)=[1,2] } }
  const frame = new Uint8Array([
    0x8a, 0x01, 0x09,            // field 17, LEN, len=9
    0x12, 0x03, 0x04, 0xaa, 0xbb, // field 2 (publicKey) len 3
    0x1a, 0x02, 0x01, 0x02,      // field 3 (permissions) packed [1,2]
  ]);
  expect(Array.from(parseWhitelistEntryPublicKey(frame)!)).toEqual([0x04, 0xaa, 0xbb]);
  // sanity: existing scanner still reads the bits from the same frame
  expect(parseWhitelistPermissions(frame)).toEqual([1, 2]);
});

test('dumpTopLevelFields lists field number + wire type + length of each top-level field', () => {
  const frame = new Uint8Array([0x82, 0x01, 0x04, 0x08, 0x02, 0x18, 0x06]); // whitelistInfo(16)
  expect(dumpTopLevelFields(frame)).toEqual([{ field: 16, wireType: 2, length: 4 }]);
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (functions not defined).
- [ ] **Step 3: Implement (append to `whitelistPermissions.ts`)**

```ts
const FIELD_ENTRY_PUBLIC_KEY = 2;

// parseWhitelistEntryPublicKey returns the publicKey bytes (field 2) of the
// WhitelistEntryInfo (field 17), or null if no entry is present.
export function parseWhitelistEntryPublicKey(fromVcsecPayload: Uint8Array): Uint8Array | null {
  const entry = findSubMessage(fromVcsecPayload, FIELD_WHITELIST_ENTRY_INFO);
  if (!entry) return null;
  const pk = findSubMessage(entry, FIELD_ENTRY_PUBLIC_KEY);
  return pk ?? null;
}

// dumpTopLevelFields enumerates every top-level field for diagnostics: which
// submessages did the car actually return? (17 = entry, 16 = info, 4 = commandStatus…)
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
```
> `FIELD_WHITELIST_ENTRY_INFO` (17) is already defined in this file. `findSubMessage` returns the inner
> bytes for a LEN field — reuse it.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ble/whitelistPermissions.ts src/ble/whitelistPermissions.test.ts
git commit -m "feat(ble): add entry-pubkey extractor + raw field dumper for whitelist probe"
```

---

### Task 3: `GET_WHITELIST_INFO` action + `slot` target arm

Give the session layer the two requests the new flow needs.

**Files:**
- Modify: `src/ble/session.ts:840-883`
- Test: `src/ble/session.test.ts` (create if absent; otherwise co-locate a small encode test)

**Interfaces:**
- Produces:
  - `vcsecGetWhitelistInfoAction(): ActionPayload` — `InformationRequest{ informationRequestType: 5 }`,
    `DOMAIN_VEHICLE_SECURITY`, `FLAG_ENCRYPT_RESPONSE_BIT`.
  - `WhitelistTargetMode` extended with `'slot'`; `WHITELIST_TARGET_MODES` reordered **slot-first**.
  - `vcsecGetWhitelistEntryAction(publicKeyRaw, mode, slot?)` — when `mode === 'slot'`, encodes
    `InformationRequest{ informationRequestType: 6, slot }`.

- [ ] **Step 1: Write the failing test** (encode-shape assertion; adapt import path to repo test setup)

```ts
import { vcsecGetWhitelistInfoAction, vcsecGetWhitelistEntryAction } from './session';
import { decodeVCSECMessage } from './proto'; // or the repo's decode helper

test('vcsecGetWhitelistInfoAction requests GET_WHITELIST_INFO (type 5)', () => {
  const a = vcsecGetWhitelistInfoAction();
  const msg = decodeVCSECMessage(a.bytes);
  expect(msg.InformationRequest.informationRequestType).toBe(5);
});

test('slot mode encodes InformationRequest.slot (oneof arm 4)', () => {
  const a = vcsecGetWhitelistEntryAction(new Uint8Array(65), 'slot', 3);
  const msg = decodeVCSECMessage(a.bytes);
  expect(msg.InformationRequest.informationRequestType).toBe(6);
  expect(msg.InformationRequest.slot).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement (edit `session.ts`)**

```ts
// add near vcsecGetStatusAction
export function vcsecGetWhitelistInfoAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeVCSECMessage({ InformationRequest: { informationRequestType: 5 } }),
  };
}

// slot-first: the firmware entry lookup is INDEX-based, so try it before key arms.
export type WhitelistTargetMode = 'slot' | 'keyId-sha1' | 'keyId-sha1-4' | 'publicKey';
export const WHITELIST_TARGET_MODES: readonly WhitelistTargetMode[] = [
  'slot', 'keyId-sha1', 'keyId-sha1-4', 'publicKey',
];

export function vcsecGetWhitelistEntryAction(
  publicKeyRaw: Uint8Array,
  mode: WhitelistTargetMode = 'slot',
  slot?: number,
): ActionPayload {
  let request: Record<string, unknown>;
  if (mode === 'slot') {
    if (slot === undefined) throw new Error('slot mode requires a slot index');
    request = { informationRequestType: 6, slot };
  } else if (mode === 'publicKey') {
    request = { informationRequestType: 6, publicKey: publicKeyRaw };
  } else {
    const digest = sha1(publicKeyRaw);
    request = {
      informationRequestType: 6,
      keyId: { publicKeySHA1: mode === 'keyId-sha1-4' ? digest.slice(0, 4) : digest },
    };
  }
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeVCSECMessage({ InformationRequest: request }),
  };
}
```

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ble/session.ts src/ble/session.test.ts
git commit -m "feat(ble): add GET_WHITELIST_INFO action + slot target arm for entry reads"
```

---

### Task 4: Orchestrate the slot-based probe + raw diagnostics in `gateway.ts`

Wire it together and **log everything the car returns** so the on-car run is conclusive.

**Files:**
- Modify: `src/ble/gateway.ts:420-475` (read this function first; integrate, don't blind-replace)

**Interfaces:**
- Consumes: `vcsecGetWhitelistInfoAction`, `vcsecGetWhitelistEntryAction`, `WHITELIST_TARGET_MODES` (session);
  `parseWhitelistInfo`, `filledSlots`, `parseWhitelistEntryPublicKey`, `parseWhitelistPermissions`,
  `hasLocalUnlock`, `describeWhitelistPermissions`, `dumpTopLevelFields` (whitelistPermissions).
- Produces: probe result `{ localUnlock: boolean | null; permissions: number[] | null; slot: number | null;
  summary: string; raw: Array<{ attempt: string; fields: string; hex: string }> }`.

- [ ] **Step 1: Read `gateway.ts:420-475`** to learn how it sends an action, awaits the decrypted
  `FromVCSECMessage` payload, and shapes its return. Reuse that send/await helper verbatim.

- [ ] **Step 2: Implement the orchestration** (algorithm — express with the repo's existing send/await helper; keep the raw log):

```ts
// PSEUDOCODE mapped onto the existing send/await helper in this function.
const raw: Array<{ attempt: string; fields: string; hex: string }> = [];
const record = (attempt: string, payload: Uint8Array) =>
  raw.push({
    attempt,
    fields: JSON.stringify(dumpTopLevelFields(payload)),
    hex: Buffer.from(payload).toString('hex'),
  });

// 1) Ask for the whitelist slot map.
const infoPayload = await send(vcsecGetWhitelistInfoAction());
record('GET_WHITELIST_INFO', infoPayload);
const info = parseWhitelistInfo(infoPayload);

// 2) Candidate slots: filled slots from the mask, else a full 0..19 sweep as fallback.
const candidateSlots = info && info.slotMask > 0 ? filledSlots(info.slotMask)
                                                 : Array.from({ length: 20 }, (_, i) => i);

// 3) Per slot: read the entry, match OUR pubkey, then read permissions from the same payload.
let found: { slot: number; permissions: number[] | null } | null = null;
for (const slot of candidateSlots) {
  const payload = await send(vcsecGetWhitelistEntryAction(deviceKeys.publicKeyRaw, 'slot', slot));
  record(`GET_WHITELIST_ENTRY_INFO slot=${slot}`, payload);
  const entryPub = parseWhitelistEntryPublicKey(payload);
  if (entryPub && bytesEqual(entryPub, deviceKeys.publicKeyRaw)) {
    found = { slot, permissions: parseWhitelistPermissions(payload) };
    break;
  }
}

// 4) Fallback: if slot targeting returned no entry at all, try the legacy key arms (still logged).
if (!found) {
  for (const mode of ['keyId-sha1', 'keyId-sha1-4', 'publicKey'] as const) {
    const payload = await send(vcsecGetWhitelistEntryAction(deviceKeys.publicKeyRaw, mode));
    record(`GET_WHITELIST_ENTRY_INFO mode=${mode}`, payload);
    const entryPub = parseWhitelistEntryPublicKey(payload);
    if (entryPub && bytesEqual(entryPub, deviceKeys.publicKeyRaw)) {
      found = { slot: -1, permissions: parseWhitelistPermissions(payload) };
      break;
    }
  }
}

return {
  slot: found?.slot ?? null,
  permissions: found?.permissions ?? null,
  localUnlock: hasLocalUnlock(found?.permissions ?? null),
  summary: found
    ? describeWhitelistPermissions(found.permissions)
    : 'no whitelistEntryInfo returned by any target arm — see raw[] (car likely does not expose the entry over BLE)',
  raw,
};
```
> Add a tiny `bytesEqual(a, b)` if the repo lacks one. **Keep `raw[]` in the result and surface it in
> the on-device diagnostics log** — it is the whole point of this task.

- [ ] **Step 3: Typecheck + existing tests**

Run: `npm run typecheck && npm test` (use the repo's commands)
Expected: PASS; no new lint/type errors.

- [ ] **Step 4: Commit**

```bash
git add src/ble/gateway.ts
git commit -m "feat(ble): slot-based whitelist permission probe with raw-reply diagnostics"
```

---

### Task 5: On-car verification (the decision point — cannot be unit-tested)

Run the probe against the user's own car and **read `raw[]`**. This determines whether a BLE permissions
read is possible at all.

- [ ] **Step 1:** Build/run the probe from the airgapp diagnostics screen (or Pi relay) with the car
  awake and in BLE range, phone key already enrolled.
- [ ] **Step 2:** Capture the `raw[]` log and classify by this decision tree:

| Observation in `raw[]` | Meaning | Next |
|---|---|---|
| A `GET_WHITELIST_ENTRY_INFO slot=N` reply whose top-level fields include **17**, and `permissions` (field 3 inside it) is non-empty | **SUCCESS** — permissions readable over BLE | Report bits; `LOCAL_UNLOCK(1)` present ⇒ passive-entry eligible |
| Field **17** present but **no field 3 bits** (`permissions: []`/`null`) across all filled slots | Car returns the entry but **omits the permission bitmap over BLE** | Go to **Task 6** (behavioral probe) |
| **No field 17** on any arm (only e.g. field 4 `commandStatus`) | Car does not answer entry reads for our key over BLE | Go to **Task 6** |

- [ ] **Step 3:** Record the outcome + a sample `raw[]` hex in
  `docs/superpowers/research/phone-key-authorization-and-passive-entry.md` (update the "verify on a live
  car" section with the empirical result). Commit.

> **Do not claim the probe "reads permissions" until Step 2 shows field 3 bits from a real car reply.**
> `null`/`[]` is a legitimate *negative* result, not a bug to keep patching.

---

### Task 6 (CONDITIONAL): Behavioral local-unlock probe — only if Task 5 shows permissions unreadable

If the car will not expose permissions over BLE, answer the real question — *"does this key have local
unlock authority?"* — by exercising it. **Side effect: this unlocks the car.** Gate behind an explicit
user confirmation and require the vehicle parked/stationary.

**Files:**
- Create: `src/ble/localUnlockProbe.ts` + `src/ble/localUnlockProbe.test.ts`
- Modify: `src/ble/gateway.ts` (add an opt-in entrypoint)

**Interfaces:**
- Produces: `interpretUnlockResult(fromVcsecPayload: Uint8Array): 'unlocked' | 'denied' | 'unknown'` (pure),
  and a gateway entrypoint that sends the VCSEC unlock (`RKEAction` unlock / the repo's existing unlock
  builder) over the authenticated session and returns the interpretation.

- [ ] **Step 1: Write the failing test** for `interpretUnlockResult` — map
  `FromVCSECMessage.commandStatus`/`vehicleStatus.vehicleLockState` to a verdict:
  `VEHICLELOCKSTATE_UNLOCKED`/`SELECTIVE_UNLOCKED` ⇒ `'unlocked'`; an authorization/insufficient-privilege
  fault ⇒ `'denied'`; anything else ⇒ `'unknown'`. (Build hand frames like Tasks 1–2. Confirm the
  `vehicleLockState` field number and enum values against `proto/vcsec.proto` / the app-side report
  before writing the frame.)
- [ ] **Step 2–4:** implement minimal, run, commit. Reuse the repo's existing unlock action builder if
  one exists (grep `Unlock`/`RKEAction`); do **not** hand-roll crypto.
- [ ] **Step 5: On-car:** with the car parked and user consent, run once. Success ⇒ the key holds local
  unlock authority (the practical equivalent of `LOCAL_UNLOCK`), independent of whether the bitmap is
  readable.

> The definitive proof of passive entry remains the end-to-end walk-up test once the background-BLE
> presence feature exists; this behavioral probe is the best pre-feature proxy.

---

## What NOT to do (guardrails)

- ❌ Regenerate `gen.js` or add `permissions`/`secondsEntryRemainsActive` to `proto/vcsec.proto`. Use the
  raw scanner (60k-line regen is disproportionate and risky).
- ❌ Any Tesla-cloud/OwnerAPI call to fetch permissions (`getWhitelistKeys`, `getVcsecperms` are the
  *official app's* cloud/native surfaces — off-limits here; the build test will fail).
- ❌ Treat `null` as `[]`, or keep "fixing the parser." The parser is correct; the open question is
  whether the **car sends the data**.
- ❌ Use the UDS routines `GET_WHITELIST_ENTRY(0x701)` / `GET_PERMISSION_FOR_KEY(0x705)` as if they were
  BLE — they are on the **diagnostic bus** (needs gateway/service access), a different surface from
  airgapp's BLE path. They inform the *model* (slot-index lookup) but are not callable from the app.

## Acceptance criteria

1. `parseWhitelistInfo`, `filledSlots`, `parseWhitelistEntryPublicKey`, `dumpTopLevelFields`,
   `vcsecGetWhitelistInfoAction`, and the `'slot'` arm all have passing unit tests.
2. The probe sends `GET_WHITELIST_INFO` then slot-targeted `GET_WHITELIST_ENTRY_INFO`, and its result
   includes a `raw[]` diagnostic log (field maps + hex) for every attempt.
3. An on-car run has been executed and classified per the Task 5 decision tree, with the empirical
   outcome recorded in the research doc.
4. If permissions are unreadable over BLE, Task 6's behavioral probe is implemented and gives a
   pass/deny verdict for local unlock.

## Provenance / deeper context (optional reading for the implementer)
- App-side RE: `~/Work/airgapp/mobile/docs/superpowers/research/phone-key-authorization-and-passive-entry.md`
- Car-side firmware RE (slot model, `GET_WHITELIST_ENTRY` INDEX-based, `GET_PERMISSION_FOR_KEY` on UDS):
  `~/Work/tesla-firmware/out/vcsec-phonekey-authz-firmware.md`
- Existing scanner + empirical "no entry" note: `src/ble/whitelistPermissions.ts`, `src/ble/session.ts:851-854`.
