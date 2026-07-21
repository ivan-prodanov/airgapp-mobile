// passiveEntryResponder.ts — M1 glue: turn a car challenge into signed bytes.
//
// Sits between the pure protocol (passiveEntryAuth.ts) and the transport. Given
// a raw unsolicited frame it returns the exact bytes to write back, or null when
// the frame is not a challenge / we cannot legitimately answer.
//
// THE SEAL (RE RESPONSE #2, from the decompiled Android signer gf0/b.java k()):
//   sessionKey = SHA1(ECDH)[:16]                (the key our commands already use)
//   iv  = counter as a raw 4-BYTE big-endian value   ← NOT 12 bytes; this was the bug
//   aad = the bare 20-byte challenge token, verbatim
//   pt  = serialized UnsignedMessage{ authenticationResponse }
//   ct,tag = AES-128-GCM(key, iv=4B, aad=token, pt)   → SignedMessage{ AES_GCM_TOKEN }
// The 4-byte IV forces GCM's GHASH J0 derivation, which no 12-byte layout can
// reproduce — see gcmShortIv.ts. All four 12-byte layouts failed on-car for this.
//
// SAFETY. Passive entry physically unlocks a car AND signs messages to a security
// controller. This refuses by construction, and — after the 2026-07-20 incident
// where a burst of malformed seals plausibly wedged the car's VCSEC until a
// restart + key re-enrollment — it also RATE-LIMITS and CIRCUIT-BREAKS:
//   • not a challenge / no token / wrong length / no live session → null
//   • caller-disabled → null before any parsing
//   • > MAX_PER_WINDOW answers in RATE_WINDOW_MS → stop (don't hammer VCSEC)
//   • MAX_CONSECUTIVE_FAULTS car rejections in a row → OPEN the breaker and stop
//     answering until reset; a persistent reject means our seal is wrong and
//     retrying only risks another lockout. Feed verdicts back via noteVerdict().

import { sha1 } from '@noble/hashes/sha1';

import { aesGcmEncryptShortIv, be32 } from './gcmShortIv';
import type { Session } from './types';
import {
  parseAuthenticationRequest,
  encodeAuthenticationResponse,
  encodeUnsignedAuthResponse,
  encodeToVcsecSignedMessage,
  describeReasons,
  AUTH_TOKEN_LENGTH,
} from './passiveEntryAuth';

// Never sign more than this many responses per window. The car challenges at
// ~1 Hz for 6-10 frames per approach; this bounds a runaway well above that.
const RATE_WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 12;
// After this many car rejections with no acceptance in between, stop. A steady
// reject means the seal is wrong; continuing only risks wedging VCSEC again.
const MAX_CONSECUTIVE_FAULTS = 6;

export interface AuthResponderOptions {
  // The session to sign with, supplied by whoever OWNS the link this responder
  // answers on. Explicit rather than looked up from a shared cache — but NOT for
  // the reason an earlier version of this comment gave.
  //
  // ⚠ CORRECTION (RE RESPONSE #8, proven against authd + the decompiled app):
  // the car's ECDH public key is STATIC/per-domain, NOT a per-handshake
  // ephemeral. So under ONE enrolled key the Pi session and a direct-BLE session
  // derive the SAME session key and SHARE ONE (key, epoch) counter on the car —
  // they are the same cryptographic identity. The "different keys and counters"
  // isolation an earlier comment claimed here does NOT exist. Real isolation
  // between the Pi path and passive entry requires TWO DISTINCT ENROLLED KEYS.
  //
  // Passing the session explicitly still matters: each transport tracks its own
  // LOCAL counter, and crossing them (signing a BLE challenge off the Pi's local
  // counter, or vice versa) desyncs from the car's shared counter and gets
  // rejected. But do not mistake that for cryptographic separation — it isn't.
  //
  // SAFETY: because the legacy passive seal uses IV = counter, two signers of
  // legacy frames under one key that ever collide on a counter = AES-GCM nonce
  // reuse (catastrophic). Today only THIS responder emits legacy frames and the
  // command path is routable (random nonce), so the spaces are disjoint — but
  // that guarantee is load-bearing. Never introduce a second legacy signer under
  // the same key. Returns null when no session is live yet; we decline, not guess.
  getSession: () => Session | null;
  enabled?: () => boolean;
  log?: (lines: string[]) => void;
}

export interface AuthResponder {
  (frame: Uint8Array): Uint8Array | null;
  // Feed the car's verdict back (parsed from its commandStatus) to drive the
  // circuit breaker: any accept clears it; consecutive faults open it.
  noteVerdict: (accepted: boolean) => void;
  reset: () => void;
}

export function makeAuthResponder(opts: AuthResponderOptions): AuthResponder {
  const say = (lines: string[]) => opts.log?.(lines);
  let recentTimes: number[] = [];
  let consecutiveFaults = 0;
  let broken = false;

  const responder = (frame: Uint8Array): Uint8Array | null => {
    if (opts.enabled && !opts.enabled()) return null;
    if (broken) return null; // circuit open — stay silent until reset()

    const req = parseAuthenticationRequest(frame);
    if (!req) return null; // routine push — not our business

    const reasons = describeReasons(req.reasons);

    if (req.token.length !== AUTH_TOKEN_LENGTH) {
      say([`auth IGNORED: token is ${req.token.length}B, expected ${AUTH_TOKEN_LENGTH}`]);
      return null;
    }

    // Rate limit BEFORE touching the session — the whole point is to not flood
    // VCSEC. Uses a coarse wall clock; Date.now is fine here.
    const now = Date.now();
    recentTimes = recentTimes.filter((t) => now - t < RATE_WINDOW_MS);
    if (recentTimes.length >= MAX_PER_WINDOW) {
      say([`auth RATE-LIMITED: ${recentTimes.length} answers in ${RATE_WINDOW_MS}ms, holding`]);
      return null;
    }

    const session = opts.getSession();
    if (!session) {
      say([`auth DROPPED (no live VCSEC session) reasons=[${reasons}]`]);
      return null;
    }

    // Monotonic anti-replay. Bump BEFORE sealing so a retry never reuses a
    // counter — the IV is derived from it, and AES-GCM nonce reuse is fatal.
    session.counter += 1;
    const counter = session.counter;

    const plaintext = encodeUnsignedAuthResponse(
      encodeAuthenticationResponse({ authenticationLevel: req.requestedLevel }),
    );
    const sealed = aesGcmEncryptShortIv(session.sessionKey, be32(counter), req.token, plaintext);
    const out = encodeToVcsecSignedMessage({
      ciphertext: sealed.ciphertext,
      tag: sealed.tag,
      keyId: sha1(session.myPubRaw).slice(0, 4),
      counter,
    });

    recentTimes.push(now);
    // counter is the JOIN KEY: the car's commandStatus echoes it, so this line
    // ties the eventual CAR VERDICT back to this exact attempt.
    say([
      `auth ANSWERED counter=${counter} iv=4B-be reasons=[${reasons}] ` +
        `level=${req.requestedLevel} out=${out.length}B`,
    ]);
    return out;
  };

  responder.noteVerdict = (accepted: boolean): void => {
    if (accepted) {
      consecutiveFaults = 0;
      return;
    }
    consecutiveFaults += 1;
    if (consecutiveFaults >= MAX_CONSECUTIVE_FAULTS && !broken) {
      broken = true;
      say([
        `auth CIRCUIT OPEN: ${consecutiveFaults} consecutive rejects — seal is wrong, ` +
          `stopping to avoid wedging VCSEC. reset() to retry.`,
      ]);
    }
  };

  responder.reset = (): void => {
    recentTimes = [];
    consecutiveFaults = 0;
    broken = false;
  };

  return responder;
}
