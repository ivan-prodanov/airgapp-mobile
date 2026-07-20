// passiveEntryResponder.ts — M1 glue: turn a car challenge into signed bytes.
//
// Sits between the pure protocol (passiveEntryAuth.ts) and the transport. Given
// a raw unsolicited frame it returns the exact bytes to write back, or null when
// the frame is not a challenge / we cannot legitimately answer.
//
// WHY THE TRANSPORT CALLS THIS (not useCarLink): the car retries at ~1 Hz and
// gives up after ~6–10 s, and the response must be signed with the live session.
// Answering inside the transport — which already owns the link, the write path
// and receives the frame first — avoids a hop through React state before we can
// reply. That matters more once M2 moves this to a background wake.
//
// SAFETY POSTURE. Passive entry physically unlocks a car, so this refuses by
// construction rather than by care:
//   • not a challenge            → null (routine pushes are untouched)
//   • no token / wrong length    → null; never sign a grant without a fresh
//                                  20-byte token (q1.java:643-652)
//   • no live authenticated session → null; we cannot sign, and must not pretend
//   • caller-disabled            → null before any parsing
// Every outcome is reported to `log` so an on-car run is diagnosable.

import { sha1 } from '@noble/hashes/sha1';

import { aesGcmEncryptWithNonce } from './crypto';
import { peekLiveSession, DOMAIN_VEHICLE_SECURITY } from './session';
import {
  parseAuthenticationRequest,
  encodeAuthenticationResponse,
  encodeUnsignedAuthResponse,
  encodeToVcsecSignedMessage,
  buildAuthIv,
  describeReasons,
  AUTH_TOKEN_LENGTH,
  IV_VARIANTS,
  type IvVariant,
} from './passiveEntryAuth';

export interface AuthResponderOptions {
  vin: string;
  // Which IV assembly to try. The exact construction is the one crypto detail
  // static RE could not pin. Pass a single variant to pin it, or 'cycle' to
  // rotate through IV_VARIANTS on successive challenges — the car sends 6-10
  // challenges per approach, so ONE handle-pull then tests every variant, and
  // its commandStatus echoes our counter so each verdict is attributable to the
  // exact variant that produced it.
  ivVariant?: IvVariant | 'cycle';
  enabled?: () => boolean;
  log?: (lines: string[]) => void;
}

export type AuthResponder = (frame: Uint8Array) => Uint8Array | null;

export function makeAuthResponder(opts: AuthResponderOptions): AuthResponder {
  const mode = opts.ivVariant ?? 'counter-last';
  const say = (lines: string[]) => opts.log?.(lines);
  let cycleIndex = 0;

  return (frame: Uint8Array): Uint8Array | null => {
    if (opts.enabled && !opts.enabled()) return null;

    const req = parseAuthenticationRequest(frame);
    if (!req) return null; // routine push — not our business

    const reasons = describeReasons(req.reasons);

    if (req.token.length !== AUTH_TOKEN_LENGTH) {
      say([`auth challenge IGNORED: token is ${req.token.length}B, expected ${AUTH_TOKEN_LENGTH}`]);
      return null;
    }

    const session = peekLiveSession(opts.vin, DOMAIN_VEHICLE_SECURITY);
    if (!session) {
      // Expected when the app is cold or the session lapsed. Worth logging
      // loudly: it is the difference between "we answered and were refused"
      // and "we were never in a position to answer".
      say([`auth challenge DROPPED (no live VCSEC session) reasons=[${reasons}]`]);
      return null;
    }

    const ivVariant: IvVariant =
      mode === 'cycle' ? IV_VARIANTS[cycleIndex++ % IV_VARIANTS.length] : mode;

    // Monotonic anti-replay. Bump BEFORE sealing so a retry never reuses a
    // counter with the same key — nonce reuse under AES-GCM is catastrophic,
    // and here the IV is derived from this counter.
    session.counter += 1;
    const counter = session.counter;

    const plaintext = encodeUnsignedAuthResponse(
      // Echo the level the car asked for; the grant is reason-independent.
      encodeAuthenticationResponse({ authenticationLevel: req.requestedLevel }),
    );
    // The token is the AAD — bound cryptographically, never echoed as a field.
    const sealed = aesGcmEncryptWithNonce(
      session.sessionKey,
      plaintext,
      req.token,
      buildAuthIv(counter, ivVariant),
    );
    const out = encodeToVcsecSignedMessage({
      ciphertext: sealed.ciphertext,
      tag: sealed.tag,
      keyId: sha1(session.myPubRaw).slice(0, 4),
      counter,
    });

    // counter is the JOIN KEY: the car's commandStatus echoes it back, so this
    // line is what lets a verdict be attributed to the variant that caused it.
    say([
      `auth ANSWERED counter=${counter} iv=${ivVariant} ` +
        `reasons=[${reasons}] level=${req.requestedLevel} out=${out.length}B`,
      `  token: ${Array.from(req.token).map((b) => b.toString(16).padStart(2, '0')).join('')}`,
    ]);
    return out;
  };
}
