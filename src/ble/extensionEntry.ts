// extensionEntry — the Share Extension's entry point into this engine.
//
// The extension is a separate process with no React Native, so it cannot use the
// app's runtime. But the Tesla protocol here is deliberately pure, sync
// TypeScript driven by an injected transport, so the extension can run THE SAME
// implementation inside JavaScriptCore rather than growing a second one in Swift.
//
// That is the whole point. A Swift port would mean re-deriving ECDH →
// SHA1(shared)[:16], the AES-GCM metadata/AAD block, the RoutableMessage
// envelope, the counter/epoch/clock merge and the framing — the AAD construction
// alone took a full reverse-engineering round-trip to get right. Two
// implementations of that which must agree forever is the worst outcome
// available. Tesla wrote theirs in Swift because their app is Swift and they had
// no JS engine to share; we are the opposite case.
//
// ── The contract with Swift ──
//
// Swift supplies three transport functions and a CSPRNG on the global object,
// then calls `airgappSendNavigation`. Nothing else crosses the boundary.
//
//   __openSession(vin)                    -> Promise<sessionId>
//   __exchange(sessionId, payloadB64, ms) -> Promise<responseB64>
//   __closeSession(sessionId)             -> Promise<void>
//   crypto.getRandomValues(u8)            -> the SAME array, filled
//
// crypto.getRandomValues is NOT optional and NOT stubbable: @noble/hashes draws
// its randomness from it, JavaScriptCore does not provide it, and a weak or
// missing implementation is a silent crypto break rather than a crash. Swift must
// back it with SecRandomCopyBytes.
//
// TextDecoder/TextEncoder are NOT in that list because the bundle polyfills them
// itself (jscPolyfills.ts). protobufjs uses them unguarded and throws at load
// without them — found by the bundle's bare-context check — but UTF-8 conversion
// is pure computation with no reason to cross the bridge, and every symbol Swift
// must install is another one that can be forgotten or subtly differ between the
// app and the extension.

// FIRST, before anything that might touch these at module scope — protobufjs
// calls TextDecoder while LOADING and throws without it.
import './jscPolyfills';

import { createCarGateway } from './gateway';
import { ExtensionBleTransport } from './extensionBleTransport';
import { hexToBytes } from './crypto';
import { p256 } from '@noble/curves/p256';
import type { CarTransport, DeviceKeys } from './types';

export interface ExtensionSendArgs {
  vin: string;
  lat: number;
  lon: number;
  // What the car shows in its route list. The caller resolves this — see
  // destinationTitle for the rules the app uses.
  label?: string;
  // The device private scalar as hex, read from the shared Keychain group.
  privateScalarHex: string;
  // Which arm to use. 'host' is a transport Swift implements behind
  // __openSession/__exchange/__closeSession (the Pi); 'ble' is THIS bundle's own
  // transport driving a dumb Swift byte pipe, because framing and correlation
  // must not be reimplemented in Swift. Defaults to 'host'.
  transport?: 'host' | 'ble';
}

export interface ExtensionSendResult {
  // True ONLY when the car itself confirmed the destination. A transport ACK is
  // not an acceptance — see `verdict` for the distinction.
  ok: boolean;
  // 'accepted'   — the car said yes
  // 'refused'    — the car said no, on the destination's merits. Terminal.
  // 'failed'     — never reached the car. Retryable.
  // 'unverified' — the send appeared to work but the car returned no verdict we
  //                could read. NOT a success: an accepted send and a refused one
  //                are indistinguishable in that case, so the caller must keep
  //                the item queued rather than claim delivery.
  verdict: 'accepted' | 'refused' | 'failed' | 'unverified';
  reason?: string;
}

declare const globalThis: {
  __openSession?: (vin: string) => Promise<string>;
  __exchange?: (sessionId: string, payloadB64: string, timeoutMs: number) => Promise<string>;
  __closeSession?: (sessionId: string) => Promise<void>;
  airgappSendNavigation?: (argsJson: string) => Promise<string>;
} & Record<string, unknown>;

// Builds the CarTransport the engine expects from the three functions Swift
// injected. Deliberately three methods and nothing else — the same surface the
// Pi client and the BLE transport implement, so the engine cannot tell which one
// it is driving.
function hostTransport(): CarTransport {
  const open = globalThis.__openSession;
  const exchange = globalThis.__exchange;
  const close = globalThis.__closeSession;
  if (!open || !exchange || !close) {
    throw new Error('extensionEntry: host did not inject __openSession/__exchange/__closeSession');
  }
  return {
    openSession: (vin) => open(vin),
    exchange: (sessionId, payloadB64, timeoutMs) => exchange(sessionId, payloadB64, timeoutMs),
    closeSession: (sessionId) => close(sessionId),
  };
}

function keysFromHex(hex: string): DeviceKeys {
  const privateScalar = hexToBytes(hex);
  // Re-derived, never stored — same rule as keystore.ts. A cached public key is
  // one more thing that can disagree with the scalar.
  return { privateScalar, publicKeyRaw: p256.getPublicKey(privateScalar, false) };
}

export async function sendNavigationFromExtension(args: ExtensionSendArgs): Promise<ExtensionSendResult> {
  let transport: CarTransport;
  try {
    transport = args.transport === 'ble' ? new ExtensionBleTransport() : hostTransport();
  } catch (err) {
    return { ok: false, verdict: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }

  try {
    const gw = createCarGateway({ transport, vin: args.vin, deviceKeys: keysFromHex(args.privateScalarHex) });
    const outcome = await gw.runCommand({
      type: 'navigateTo',
      lat: args.lat,
      lon: args.lon,
      label: args.label,
    });

    if (!outcome.ok) {
      // A semantic fault is the car refusing on the merits; everything else
      // (unreachable, timeout, auth, exhausted) never got a verdict and is worth
      // retrying later.
      return outcome.kind === 'fault'
        ? { ok: false, verdict: 'refused', reason: outcome.message }
        : { ok: false, verdict: 'failed', reason: outcome.message };
    }

    // ok:true is the ROUTABLE layer accepting the frame. The car's own answer is
    // in carStatus, and its ABSENCE is not consent.
    if (outcome.carStatus?.ok === true) return { ok: true, verdict: 'accepted' };
    if (outcome.carStatus?.ok === false) {
      return { ok: false, verdict: 'refused', reason: outcome.carStatus.reason ?? 'the car refused it' };
    }
    return { ok: false, verdict: 'unverified', reason: 'the car returned no verdict' };
  } catch (err) {
    return { ok: false, verdict: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

// The single symbol Swift calls. JSON in, JSON out — JavaScriptCore's bridging of
// structured values is fiddly and version-sensitive, and a string is the one
// thing that crosses cleanly in every direction.
globalThis.airgappSendNavigation = async (argsJson: string): Promise<string> => {
  try {
    const parsed = JSON.parse(argsJson) as ExtensionSendArgs;
    return JSON.stringify(await sendNavigationFromExtension(parsed));
  } catch (err) {
    // Never throw across the bridge: an exception surfacing in JSC is far harder
    // to diagnose from Swift than a result object saying what went wrong.
    const result: ExtensionSendResult = {
      ok: false,
      verdict: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }
};
