// gateway.ts — CarGateway, the top-level integrator over the BLE stack.
//
// Ported from the browser reference (rpi-webclient/client/app.js `_directDo`,
// lines ~754–1000): the 10-attempt fault-recovery retry loop that drives one
// built command through the per-VIN queue + cached session engine, recovering
// from transport-dead links, stale Pi frames, and car-side session-stale /
// transient faults, and stopping on semantic faults.
//
// What was dropped from the reference (deliberately, per the P3b brief):
//   • the Alpine UI chatter (this.directStatus, notify, logActivity toasts,
//     _faultName toast strings) — replaced by a structured CommandOutcome.
//   • the in-session piggyback read (one warm extra round-trip after a
//     command to refresh the slice it changed) — deferred to a later phase;
//     for v1 the caller polls reads (readVcsecStatus / awakeSync) separately.
//
// This module owns NO React/Expo/network imports and no hardware — it is the
// pure integrator the session engine, queue, telemetry and command builders
// plug into. Timers are injectable (the `sleep` arg) so tests never wait on a
// real clock.

import { buildCommand, type CarCommand } from "./commands";
import { SessionQueue, type JobPriority } from "./queue";
import {
  withCachedSession,
  refreshCachedSession,
  evictSession,
  type EvictScope,
  sendCommand,
  evaluateFault,
  isTransportDeadError,
  isStaleFrameError,
  vcsecGetStatusAction,
  vcsecGetWhitelistEntryAction,
  vcsecGetWhitelistInfoAction,
  WHITELIST_TARGET_MODES,
  type WhitelistTargetMode,
  TRANSIENT_DELAY_MS,
  MAX_BLE_ATTEMPTS as SESSION_MAX_BLE_ATTEMPTS,
  type ActionPayload,
  type CommandResult,
} from "./session";
import {
  getChargeStateAction,
  getClimateStateAction,
  getDriveStateAction,
  getLocationStateAction,
} from "./builders";
import { decodeMessage, FromVCSECMessage, Response } from "./proto";
import { parseCarActionStatus, type CarActionStatus } from "./carActionStatus";
import {
  parseWhitelistPermissions,
  describeWhitelistPermissions,
  hasLocalUnlock,
  parseWhitelistInfo,
  filledSlots,
  parseWhitelistEntryPublicKey,
  dumpEntryFields,
  bytesEqual,
} from "./whitelistPermissions";
import {
  parseVcsecStatus,
  parseCarServerResponse,
  type VcsecStatus,
  type InfotainmentSnapshot,
} from "./telemetry";
import type { Domain, DeviceKeys, PiTransport } from "./types";
import { logw } from "../services/logbus";

// Re-export the attempt cap under this module's name (it lives with the other
// protocol primitives in session.ts; the reference kept it on the airgap.*
// namespace the loop reads).
export const MAX_BLE_ATTEMPTS = SESSION_MAX_BLE_ATTEMPTS;

// CommandOutcome is the structured result of runCommand — what the reference
// expressed only as toast side effects. `ok:true` carries the attempt count
// (1 = first try). The failure `kind`s split into the car saying no (semantic
// `fault`, non-retryable) and the link never delivering a clean answer
// (`unreachable`/`timeout`/`auth`/`exhausted`).
export type CommandOutcome =
  | { ok: true; attempts: number; carStatus?: CarActionStatus }
  | {
      ok: false;
      kind: "fault";
      faultName: string;
      fault: number;
      message: string;
    }
  // `cancelled` (C3) is NOT a failure the user should ever be told about — it
  // means a NEWER command for the same lane superseded this one, so we stopped
  // retrying a value the user has already moved past. The coalescer has already
  // neutralised its rollback. Distinct from `timeout`/`exhausted` precisely so
  // the UI can stay silent instead of toasting a "failure" the user caused.
  | { ok: false; kind: "cancelled"; message: string }
  | {
      ok: false;
      kind: "unreachable" | "timeout" | "auth" | "exhausted";
      message: string;
    };

// WhitelistEntryProbe is the result of asking the car what it granted our key.
// `permissions: null` = UNKNOWN (no permissions field in the reply), which is
// NOT the same as an empty grant — see readWhitelistEntry.
// One targeting attempt, kept so an inconclusive probe is diagnosable from the
// device log rather than by guesswork.
export interface WhitelistProbeAttempt {
  mode: WhitelistTargetMode;
  // Which FromVCSECMessage oneof arm came back ('whitelistEntryInfo',
  // 'nominalError', 'vehicleStatus', …) — usually the decisive clue.
  subMessage: string | null;
  rawHex: string | null;
  permissions: number[] | null;
  error: string | null;
}

// One slot's entry, for the control-group comparison.
export interface WhitelistSlotSurvey {
  slot: number;
  // Which fields the entry actually carried, e.g. [1,2,4,6,7]. The question is
  // whether ANY key shows field 3 (permissions).
  fields: number[] | null;
  permissions: number[] | null;
  keyRole: number | null;
  isOurs: boolean;
  error: string | null;
}

export interface WhitelistEntryProbe {
  // Which arm the car accepted, or null if none did.
  matchedMode: WhitelistTargetMode | null;
  attempts: WhitelistProbeAttempt[];
  // Slot map + per-slot survey (null if GET_WHITELIST_INFO gave us nothing).
  slotMask: number | null;
  numberOfEntries: number | null;
  survey: WhitelistSlotSurvey[];
  permissions: number[] | null;
  // true = passive-entry eligible, false = walk-up would be refused,
  // null = couldn't tell.
  localUnlock: boolean | null;
  keyRole: number | null;
  slot: number | null;
  // Human-readable verdict for the on-device diagnostics log.
  summary: string;
}

// The state slices awakeSync can read, named so a caller can ask for a subset.
export type InfotainmentStateKey = "charge" | "climate" | "drive" | "location";

export interface CarGateway {
  // `opts.signal` (C3) lets a superseding command stop this one's retry loop.
  runCommand(
    cmd: CarCommand,
    opts?: { signal?: AbortSignal },
  ): Promise<CommandOutcome>;
  readVcsecStatus(): Promise<VcsecStatus>;
  // Passive-entry precondition probe — see readWhitelistEntry's implementation.
  readWhitelistEntry(): Promise<WhitelistEntryProbe>;
  // `priority: 'background'` makes this yield to user commands in the per-VIN
  // queue. The POLL must pass it; pull-to-refresh must not.
  awakeSync(opts?: {
    states?: InfotainmentStateKey[];
    priority?: JobPriority;
  }): Promise<InfotainmentSnapshot>;
  wake(): Promise<CommandOutcome>;
  // EXPERIMENT-ONLY escape hatch: drive one hand-built ActionPayload through the
  // normal seal/retry/session machinery and hand back the raw reply. It exists
  // for on-car probes of messages that have no CarCommand variant because we do
  // not yet know whether the car honours them at all (VDS-M1). Anything that
  // turns out to work should graduate to a real CarCommand rather than keep
  // calling this.
  runRawAction(
    action: ActionPayload,
    label: string,
  ): Promise<{ outcome: CommandOutcome; result: CommandResult | null }>;
}

export interface CreateCarGatewayArgs {
  transport: PiTransport;
  vin: string;
  deviceKeys: DeviceKeys;
  // Injectable so multiple gateways / the app can share one per-VIN FIFO.
  // Defaults to a fresh queue.
  queue?: SessionQueue;
  // Injectable retry-delay timer (defaults to a real setTimeout). Tests pass a
  // no-op recorder so the 100ms transient/stale-frame waits are instantaneous
  // yet still assertable.
  sleep?: (ms: number) => Promise<void>;
  // Injectable clock (defaults to Date.now), so the deadline below is testable
  // without waiting on a real one.
  now?: () => number;
  // Overall wall-clock budget for ONE command, across every attempt/evict/
  // delay. See DEFAULT_COMMAND_DEADLINE_MS.
  commandDeadlineMs?: number;
}

// The official app surfaces a failed command at exactly 25s; match it. This is
// a REAL deadline — runAction stops retrying and returns kind:'timeout' — not a
// UI timer, so nothing keeps talking to the car behind a failure the user has
// already been shown.
export const DEFAULT_COMMAND_DEADLINE_MS = 25_000;

// evictScopeFor — how much to tear down for a given transport failure.
//
// 'unreachable' means the transport could not reach the car at all (Pi down, car
// out of range): the link is gone and every domain on it with it.
//
// 'timeout' means we wrote fine and no matching reply came back within the
// budget. That is NOT evidence of a dead link — PE-4 measured the car answering
// VCSEC normally right after a domain-3 read timed out — so it must take only
// the domain that failed. Evicting both made a background readout capable of
// adding 4 seconds to the next unlock.
// How long a BACKGROUND read may hold the queue.
//
// The priority queue lets a user command jump QUEUED background work, but not
// the one already on the wire — a BLE exchange cannot be abandoned mid-counter.
// So the true worst case for a tap is however long the in-flight job runs, and
// with the normal 4-6s command timeout that is FOUR TO SIX SECONDS, not the
// ~180ms a healthy read takes. PE-4 hit exactly that: a domain-3 warm-up read
// timed out at 4000ms in ordinary conditions.
//
// A background read is speculative and discardable — nothing is waiting on it,
// and the next tick re-reads anyway. So it gets a tight deadline: give up fast
// and let the queue move rather than sit on the link hoping. This is what bounds
// a user command's wait to something a person will accept.
export const BACKGROUND_READ_TIMEOUT_MS = 1200;

export function evictScopeFor(kind: string): EvictScope {
  return kind === "timeout" ? "domain" : "link";
}

// _faultName lifts a MessageFault_E code to its name (ported verbatim from the
// reference's _faultName so semantic faults read human-friendly in the
// CommandOutcome message).
const FAULT_NAMES: Record<number, string> = {
  0: "NONE",
  1: "BUSY",
  2: "TIMEOUT",
  3: "UNKNOWN_KEY_ID",
  4: "INACTIVE_KEY",
  5: "INVALID_SIGNATURE",
  6: "INVALID_TOKEN_OR_COUNTER",
  7: "INSUFFICIENT_PRIVILEGES",
  8: "INVALID_DOMAINS",
  9: "INVALID_COMMAND",
  10: "DECODING",
  11: "INTERNAL",
  12: "WRONG_PERSONALIZATION",
  13: "BAD_PARAMETER",
  14: "KEYCHAIN_IS_FULL",
  15: "INCORRECT_EPOCH",
  16: "IV_INCORRECT_LENGTH",
  17: "TIME_EXPIRED",
  18: "NOT_PROVISIONED",
  19: "COULD_NOT_HASH_METADATA",
};

function faultName(fault: number): string {
  return FAULT_NAMES[fault] ?? `unknown(${fault})`;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

// classifyTransportError maps a rethrown transport-level error onto a terminal
// CommandOutcome kind. A TransportError carries its own `kind` (the Pi's HTTP
// contract); anything without one is treated as unreachable.
function classifyTransportError(
  e: unknown,
): "unreachable" | "timeout" | "auth" {
  const kind = (e as { kind?: unknown } | null)?.kind;
  if (kind === "auth") return "auth";
  if (kind === "timeout") return "timeout";
  // 'session-gone' / 'ble' / 'network' / 'http' / no kind → unreachable.
  return "unreachable";
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// bytesToHexDump renders a payload for the on-device diagnostics log. Capped —
// these are small VCSEC replies, and an unbounded dump would flood the log.
function bytesToHexDump(b: Uint8Array, max = 96): string {
  const shown = Array.from(b.subarray(0, max))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join(" ");
  return b.length > max
    ? `${shown} …(${b.length} bytes)`
    : `${shown} (${b.length} bytes)`;
}

export function createCarGateway({
  transport,
  vin,
  deviceKeys,
  queue = new SessionQueue(),
  sleep = realSleep,
  now = Date.now,
  commandDeadlineMs = DEFAULT_COMMAND_DEADLINE_MS,
}: CreateCarGatewayArgs): CarGateway {
  // runAction is the shared heart of the gateway: the ported _directDo retry
  // loop. It drives ONE built action through the queue + cached session with
  // the full fault-recovery policy and returns both the structured outcome and
  // the raw CommandResult (so read paths can decode the response payload).
  async function runAction(
    action: ActionPayload,
    label: string,
    signal?: AbortSignal,
  ): Promise<{ outcome: CommandOutcome; result: CommandResult | null }> {
    const flags = action.flags ?? 0;
    let lastResult: CommandResult | null = null;

    // Overall wall-clock budget for this command. The attempt cap alone doesn't
    // bound total time — a single attempt can burn a full scan/HTTP timeout, so
    // 10 of them can run far past what a user will wait.
    const startedAt = now();
    const deadlineExceeded = () => now() - startedAt >= commandDeadlineMs;
    const timedOut = (): {
      outcome: CommandOutcome;
      result: CommandResult | null;
    } => ({
      outcome: {
        ok: false,
        kind: "timeout",
        message: `[${label}] timeout: command deadline exceeded`,
      },
      result: lastResult,
    });
    // C3 — in-flight cancellation. Checked ONLY between attempts, never mid
    // exchange, and identically for BOTH transports (BLE and Pi stay on par —
    // transport selection is invisible to the user, so cancellation latency
    // must not depend on it). Mid-exchange abort was rejected: DirectBleTransport
    // allows exactly one in-flight exchange, and abandoning a reply-wait rejects
    // as "stale frame", which this very loop then treats as a car fault and
    // RETRIES — i.e. it would disguise a deliberate cancel as a failure.
    const cancelled = (): {
      outcome: CommandOutcome;
      result: CommandResult | null;
    } => ({
      outcome: {
        ok: false,
        kind: "cancelled",
        message: `[${label}] cancelled: superseded by a newer command`,
      },
      result: lastResult,
    });

    // runAttempts is the retry loop itself. It is BOUNDED but not guaranteed to
    // settle: its cheap `deadlineExceeded()` check runs at the TOP of every
    // attempt (also the landing point of every evict/delay `continue`), so no
    // retry can START past the deadline — but a single attempt that never
    // settles (a wedged native BLE await) never returns to that check. That's
    // what the Promise.race below backstops.
    async function runAttempts(): Promise<{
      outcome: CommandOutcome;
      result: CommandResult | null;
    }> {
      // Bounds how many times an "unreachable/timeout" failure evicts + retries
      // (re-handshake, which re-selects the transport under a SelectingTransport).
      // Enough to fall over to the other transport once or twice, but capped so
      // "everything down" fails in bounded time rather than spinning MAX attempts
      // through full scan/HTTP timeouts on both transports.
      let unreachableEvicts = 0;
      const MAX_UNREACHABLE_EVICTS = 2;

      for (let attempt = 1; attempt <= MAX_BLE_ATTEMPTS; attempt++) {
        if (signal?.aborted) return cancelled();
        if (deadlineExceeded()) return timedOut();
        let result: CommandResult;
        try {
          result = await queue.enqueue(vin, () =>
            withCachedSession(
              { transport, vin, deviceKeys, domain: action.domain },
              async (session) => {
                // Domain lockstep guard (carry-forward): the cached session MUST
                // target the same domain the command was built for. A mismatch is
                // an engine bug that would otherwise surface as an opaque car-side
                // signature fault — throw a clear local error instead.
                if (session.domain !== action.domain) {
                  throw new Error(
                    `gateway domain lockstep violation: session.domain=${session.domain} built.domain=${action.domain}`,
                  );
                }
                return sendCommand({
                  transport,
                  session,
                  payloadBytes: action.bytes,
                  flags,
                });
              },
            ),
          );
        } catch (e) {
          // Transport-dead: the cached BLE link is gone. A SessionInfoRequest on
          // the same dead link would just re-fail, so evict (full teardown) and
          // let the next attempt cold-handshake a fresh Pi session.
          if (isTransportDeadError(e) && attempt < MAX_BLE_ATTEMPTS) {
            await evictSession(vin, action.domain, { reason: 'transport-dead' }).catch(() => {});
            continue;
          }
          // Stale Pi frame (or decrypt-fail-as-stale-frame): the link is fine, a
          // buffered/foreign frame came back. Re-send with a fresh counter+uuid
          // after a short delay. This is where the engine's decrypt-fail race
          // (isStaleFrameError) becomes a RETRY, not a user-facing error.
          if (isStaleFrameError(e) && attempt < MAX_BLE_ATTEMPTS) {
            await sleep(TRANSIENT_DELAY_MS);
            continue;
          }
          // A transport that can't reach the car (network unreachable / timeout —
          // e.g. the Pi went down, or the car drifted out of BLE range) means the
          // current session's transport is no longer viable. Evict + retry: the
          // re-opened session cold-handshakes, and under a SelectingTransport that
          // RE-SELECTS (BLE-first), so a dead Pi falls over to BLE (and vice
          // versa). Capped so "everything down" exhausts quickly. Auth failures
          // (bad/revoked bearer) are NOT retried — a re-handshake can't fix them.
          const kind = classifyTransportError(e);
          if (
            (kind === "unreachable" || kind === "timeout") &&
            unreachableEvicts < MAX_UNREACHABLE_EVICTS &&
            attempt < MAX_BLE_ATTEMPTS
          ) {
            unreachableEvicts += 1;
            // See evictScopeFor: a timeout takes THIS domain only. A stale frame
            // that exhausts its retries above lands here and classifies as
            // 'timeout', which is how a background drive read was destroying the
            // VCSEC session that locks the car.
            await evictSession(vin, action.domain, {
              scope: evictScopeFor(kind),
              reason: kind,
            }).catch(() => {});
            await sleep(TRANSIENT_DELAY_MS);
            continue;
          }
          // Anything else (auth, or unreachable past the cap) is terminal.
          return {
            outcome: {
              ok: false,
              kind,
              message: `[${label}] ${kind}: ${errMsg(e)}`,
            },
            result: lastResult,
          };
        }

        lastResult = result;
        const status = result.routable.signedMessageStatus;
        const opStatus = status?.operationStatus;
        const fault = status?.signedMessageFault ?? 0;

        // opStatus 0 (or absent) means the ROUTABLE layer accepted the frame. It
        // does NOT mean the car carried the command out — that verdict is in
        // CarServer's Response.actionStatus, which we decode here.
        if (opStatus === 0 || opStatus === undefined) {
          const carStatus = parseCarActionStatus(result.decryptedPayload);
          if (carStatus && !carStatus.ok) {
            logw("gateway", "car rejected command", { label, reason: carStatus.reason });
          }
          // Only NAVIGATION is failed on the car's verdict for now. Other commands
          // may be returning ERROR today in ways the app tolerates silently, and
          // flipping all of them at once would invent user-visible failures with
          // no evidence behind them. The log line above is how we gather that
          // evidence; widen this once we know what it says.
          const isNav = label.startsWith("navigate");
          if (isNav && carStatus && !carStatus.ok) {
            return {
              outcome: {
                ok: false,
                kind: "fault",
                fault: 0,
                faultName: "carRejected",
                message: `[${label}] the car rejected it${carStatus.reason ? `: ${carStatus.reason}` : ""}`,
              },
              result,
            };
          }
          // Omit the key entirely rather than assigning `carStatus: undefined` —
          // an explicit-undefined own property is NOT the same as an absent one
          // to assert.deepEqual, and would break every pre-existing outcome
          // assertion of the form `{ ok: true, attempts: N }`.
          return {
            outcome: carStatus
              ? { ok: true, attempts: attempt, carStatus }
              : { ok: true, attempts: attempt },
            result,
          };
        }

        const policy = evaluateFault(fault);
        if (!policy.retryable) {
          // Semantic fault — the car rejected the command on its merits. Stop.
          const name = faultName(fault);
          return {
            outcome: {
              ok: false,
              kind: "fault",
              fault,
              faultName: name,
              message: `[${label}] fault ${fault} (${name})`,
            },
            result,
          };
        }

        if (policy.category === "session-stale") {
          // Refresh the session key in place on the same BLE link (no teardown),
          // then retry. Fall back to a full evict on failure (inside
          // refreshCachedSession). Swallow — a failed refresh still retries.
          await refreshCachedSession({
            transport,
            vin,
            domain: action.domain,
            deviceKeys,
          }).catch(() => false);
        }
        if (policy.delayMs > 0) await sleep(policy.delayMs);
        // loop continues with another attempt
      }

      // Every attempt was retryable but none succeeded.
      return {
        outcome: {
          ok: false,
          kind: "exhausted",
          message: `[${label}] exhausted ${MAX_BLE_ATTEMPTS} attempts`,
        },
        result: lastResult,
      };
    }

    // HARD deadline. The between-attempt check above is cheap and stops work
    // early on the normal path, but it can only fire while the loop is running.
    // Race the WHOLE loop against a real wall-clock timer so runAction always
    // settles within commandDeadlineMs even if one attempt wedges forever
    // (a hung BLE connect/discover/write) — which is exactly how the UI spinner
    // used to hang indefinitely.
    //
    // Deliberately a REAL setTimeout, not the injectable `sleep`: tests inject
    // an instant no-op sleep, which would make the deadline fire immediately.
    //
    // The timer RESOLVES (never rejects) with the same timedOut() shape the
    // between-attempt check returns, so callers see an identical
    // { ok:false, kind:'timeout' } outcome from either path.
    //
    // NOTE: when the timer wins, the loop may still be running — we cannot
    // cancel a hung native BLE await. DirectBleTransport bounds each of those
    // awaits (connect/discover/MTU) so the orphan dies on its own; the
    // user-visible guarantee here is only that the COMMAND always terminates
    // at the deadline.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadlineTimer = new Promise<{
      outcome: CommandOutcome;
      result: CommandResult | null;
    }>((resolve) => {
      timer = setTimeout(() => resolve(timedOut()), commandDeadlineMs);
    });
    try {
      return await Promise.race([runAttempts(), deadlineTimer]);
    } finally {
      // Clear it when the loop wins, so a pending 25s timer never keeps the
      // process/handle alive after the command is done.
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function runCommand(
    cmd: CarCommand,
    opts?: { signal?: AbortSignal },
  ): Promise<CommandOutcome> {
    const built = buildCommand(cmd);
    const { outcome } = await runAction(built, cmd.type, opts?.signal);
    return outcome;
  }

  async function readVcsecStatus(): Promise<VcsecStatus> {
    // Runs through the same retry loop (single encrypted VCSEC read). Works
    // while the car sleeps — VCSEC stays awake. The FLAG_ENCRYPT_RESPONSE
    // round-trip is exercised here: vcsecGetStatusAction sets the flag, and a
    // successful decode of the sealed FromVCSECMessage proves it end-to-end.
    const action = vcsecGetStatusAction();
    const { outcome, result } = await runAction(action, "vcsecGetStatus");
    if (!outcome.ok) {
      throw new Error(`readVcsecStatus failed: ${outcome.message}`);
    }
    if (!result?.decryptedPayload) {
      throw new Error(
        "readVcsecStatus: car returned no encrypted status payload",
      );
    }
    const fromVcsec = decodeMessage(
      FromVCSECMessage,
      result.decryptedPayload,
    ) as { vehicleStatus?: unknown };
    return parseVcsecStatus(fromVcsec.vehicleStatus);
  }

  // readWhitelistEntry asks the car which permissions it granted OUR key, to
  // settle the single firmware-side unknown blocking passive entry: does
  // ROLE_DRIVER expand to include LOCAL_UNLOCK(1) on this car? (research doc
  // §1.4/§3.1.3).
  //
  // It tries each way of naming our entry (keyId-SHA1, keyId-SHA1[:4],
  // publicKey) and STOPS at the first reply that actually carries a
  // whitelistEntryInfo. The first on-car run targeted `publicKey` and came back
  // with no entry at all, which is a REQUEST problem, not a firmware answer —
  // the accepted oneof arm isn\'t documented anywhere we can read, and
  // KeyIdentifier.publicKeySHA1 + research §1.2 point at the SHA1 arms.
  //
  // Every attempt records the RAW reply bytes, so an inconclusive run can be
  // diagnosed from the hex instead of guessing and walking back to the car.
  //
  // `permissions: null` means UNKNOWN (car sent no permissions field), which is
  // deliberately NOT collapsed to an empty list — "we could not tell" and "the
  // car granted nothing" are very different answers.
  async function readWhitelistEntry(): Promise<WhitelistEntryProbe> {
    const attempts: WhitelistProbeAttempt[] = [];

    for (const mode of WHITELIST_TARGET_MODES) {
      const action = vcsecGetWhitelistEntryAction(
        deviceKeys.publicKeyRaw,
        mode,
      );
      let payload: Uint8Array | null = null;
      let error: string | null = null;
      try {
        const { outcome, result } = await runAction(
          action,
          `vcsecGetWhitelistEntry:${mode}`,
        );
        if (!outcome.ok) {
          error = outcome.message;
        } else {
          payload = result?.decryptedPayload ?? null;
          if (!payload) error = "car returned no encrypted payload";
        }
      } catch (e) {
        error = errMsg(e);
      }

      if (!payload) {
        attempts.push({
          mode,
          subMessage: null,
          rawHex: null,
          permissions: null,
          error,
        });
        continue;
      }

      const fromVcsec = decodeMessage(FromVCSECMessage, payload) as {
        subMessage?: string;
        whitelistEntryInfo?: { keyRole?: number; slot?: number };
      };
      const permissions = parseWhitelistPermissions(payload);
      attempts.push({
        mode,
        subMessage: fromVcsec.subMessage ?? null,
        rawHex: bytesToHexDump(payload),
        permissions,
        error: null,
      });

      // A reply carrying our entry is the answer — stop probing arms.
      if (fromVcsec.whitelistEntryInfo) {
        return {
          permissions,
          localUnlock: hasLocalUnlock(permissions),
          keyRole: fromVcsec.whitelistEntryInfo.keyRole ?? null,
          slot: fromVcsec.whitelistEntryInfo.slot ?? null,
          summary: describeWhitelistPermissions(permissions),
          matchedMode: mode,
          attempts,
          ...(await surveyWhitelistSlots()),
        };
      }
    }

    // No arm produced an entry. Report it as UNKNOWN (never as "denied") and
    // hand back every attempt so the hex can be read.
    return {
      permissions: null,
      localUnlock: null,
      keyRole: null,
      slot: null,
      summary:
        "permissions: UNKNOWN — no targeting arm produced a whitelistEntryInfo. " +
        "This is a REQUEST-side result, not a firmware verdict; see the per-attempt hex.",
      matchedMode: null,
      attempts,
      slotMask: null,
      numberOfEntries: null,
      survey: [],
    };
  }

  // surveyWhitelistSlots is the CONTROL GROUP for the permissions question.
  //
  // Our own entry comes back with no permissions field. On its own that is
  // ambiguous: either our ROLE_DRIVER enrollment materialized an empty set (a
  // real problem we could act on), or this firmware simply never puts
  // permissions in a BLE reply (in which case no amount of probing will help and
  // the question must be answered behaviourally). The only way to tell them
  // apart is to read the car's OTHER keys — the official Tesla phone key and the
  // NFC card, which certainly DO have unlock authority — and compare.
  //
  // GET_WHITELIST_INFO gives the slot map; each filled slot is then read by the
  // 'slot' oneof arm and reduced to the list of field numbers it carried.
  async function surveyWhitelistSlots(): Promise<{
    slotMask: number | null;
    numberOfEntries: number | null;
    survey: WhitelistSlotSurvey[];
  }> {
    let slotMask: number | null = null;
    let numberOfEntries: number | null = null;
    let slots: number[];
    try {
      const { outcome, result } = await runAction(
        vcsecGetWhitelistInfoAction(),
        "vcsecGetWhitelistInfo",
      );
      const payload = outcome.ok ? (result?.decryptedPayload ?? null) : null;
      const info = payload ? parseWhitelistInfo(payload) : null;
      if (info) {
        slotMask = info.slotMask;
        numberOfEntries = info.numberOfEntries;
      }
    } catch {
      // fall through to the sweep
    }
    // Fall back to a bounded sweep when the mask is unavailable: the firmware
    // model is 20 slots (0..19), slot 0 reserved for the vehicle's own key.
    slots =
      slotMask && slotMask > 0
        ? filledSlots(slotMask)
        : Array.from({ length: 20 }, (_, i) => i);

    const survey: WhitelistSlotSurvey[] = [];
    for (const slot of slots) {
      try {
        const { outcome, result } = await runAction(
          vcsecGetWhitelistEntryAction(deviceKeys.publicKeyRaw, "slot", slot),
          `vcsecGetWhitelistEntry:slot=${slot}`,
        );
        if (!outcome.ok || !result?.decryptedPayload) {
          survey.push({
            slot,
            fields: null,
            permissions: null,
            keyRole: null,
            isOurs: false,
            error: outcome.ok ? "no payload" : outcome.message,
          });
          continue;
        }
        const payload = result.decryptedPayload;
        const decoded = decodeMessage(FromVCSECMessage, payload) as {
          whitelistEntryInfo?: { keyRole?: number };
        };
        const pub = parseWhitelistEntryPublicKey(payload);
        survey.push({
          slot,
          fields: (dumpEntryFields(payload) ?? []).map((f) => f.field),
          permissions: parseWhitelistPermissions(payload),
          keyRole: decoded.whitelistEntryInfo?.keyRole ?? null,
          isOurs: !!pub && bytesEqual(pub, deviceKeys.publicKeyRaw),
          error: null,
        });
      } catch (e) {
        survey.push({
          slot,
          fields: null,
          permissions: null,
          keyRole: null,
          isOurs: false,
          error: errMsg(e),
        });
      }
    }
    return { slotMask, numberOfEntries, survey };
  }

  async function awakeSync(opts?: {
    states?: InfotainmentStateKey[];
    priority?: JobPriority;
  }): Promise<InfotainmentSnapshot> {
    // State reads on ONE warm INFOTAINMENT session (single handshake).
    // Does NOT wake — the caller wakes first if the car is asleep; on an
    // asleep car these reads fault, which surfaces via the thrown error.
    //
    // `states` scopes the read. That is what makes a fast cadence affordable:
    // each entry is a full command round-trip, so the default four-state read
    // costs 4x a scoped one, and it is the per-tick COST — not the interval —
    // that forced the 60s throttle. The official app never pays this: over BLE
    // it fetches ONE state chosen by the visible screen
    // ('on controls screen, fetching drive state' / 'on climate screen,
    // fetching climate only'). See viewFocusReads.ts.
    const byKey: Record<InfotainmentStateKey, () => ActionPayload> = {
      charge: getChargeStateAction,
      climate: getClimateStateAction,
      drive: getDriveStateAction,
      location: getLocationStateAction,
    };
    const keys =
      opts?.states ??
      (["charge", "climate", "drive", "location"] as InfotainmentStateKey[]);
    if (keys.length === 0)
      throw new Error("awakeSync: states must not be empty");
    const reads: ActionPayload[] = keys.map((k) => byKey[k]());
    const domain: Domain = reads[0].domain;
    const { out: slices, sawFault: anyFault } = await queue.enqueue(
      vin,
      () =>
        withCachedSession(
          { transport, vin, deviceKeys, domain },
          async (session) => {
            const out: InfotainmentSnapshot[] = [];
            let sawFault = false;
            for (const read of reads) {
              if (session.domain !== read.domain) {
                throw new Error(
                  `gateway domain lockstep violation: session.domain=${session.domain} read.domain=${read.domain}`,
                );
              }
              const res = await sendCommand({
                transport,
                session,
                payloadBytes: read.bytes,
                flags: read.flags ?? 0,
              });
              // Mirror runAction's success check: opStatus 0 (or absent) is
              // success. A car-side fault comes back status-only — no thrown
              // error, no decryptedPayload — so it must be detected here, not
              // inferred from a catch block.
              const opStatus =
                res.routable.signedMessageStatus?.operationStatus;
              const succeeded = opStatus === 0 || opStatus === undefined;
              if (res.decryptedPayload) {
                const carResp = decodeMessage(Response, res.decryptedPayload);
                out.push(parseCarServerResponse(carResp));
              }
              if (!succeeded || !res.decryptedPayload) sawFault = true;
            }
            return { out, sawFault };
          },
        ),
      { priority: opts?.priority },
    );
    if (slices.length === 0 && anyFault) {
      // All four reads faulted (or came back status-only with no payload) —
      // most commonly because the car is asleep/unreachable. Surface this as
      // a failure instead of a silent empty snapshot so the caller can tell
      // "car unreachable" apart from "car has no data".
      throw new Error(
        "awakeSync: no vehicle data — is the car awake? (all reads faulted)",
      );
    }
    // Merge the populated slices into one snapshot. This is safe (no
    // clobbering) only because each read writes a DISTINCT sub-key
    // (charge/climate/drive/location) — the merge itself enforces no
    // ordering guarantee beyond that disjointness.
    return slices.reduce<InfotainmentSnapshot>(
      (acc, s) => ({ ...acc, ...s }),
      {},
    );
  }

  async function wake(): Promise<CommandOutcome> {
    return runCommand({ type: "wake" });
  }

  return {
    runCommand,
    readVcsecStatus,
    readWhitelistEntry,
    awakeSync,
    wake,
    runRawAction: runAction,
  };
}
