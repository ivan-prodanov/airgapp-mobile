// transport.ts — fetch-backed PiTransport for the RPi BLE byte-forwarder's
// /api/ble/* HTTP API. This is the ONLY place in the app that speaks HTTP to
// the Pi; session.ts (the protocol engine) only knows the PiTransport
// interface (openSession/exchange/closeSession) from ./types, so it can be
// driven by a fake transport in tests without any of this file.
//
// PiClient implements that interface plus the enrollment superset the
// pairing/token-management screens need (pairInfo/setVin/enrollPublicKey/
// tokenInfo/revokeToken) — one class, one name, no collision with the
// interface it satisfies.
//
// Reference: the browser client's `api.request` wrapper
// (rpi-webclient/client/app.js, the bearer-fetch-with-timeout wrapper this
// file's request() ports to TypeScript with typed errors instead of a single
// generic Error).

import type { PiTransport } from './types';
import { assertPiBaseUrl } from './teslaHostGuard';

// --- Typed errors ------------------------------------------------------

// TransportErrorKind mirrors the Pi's HTTP contract onto the shapes callers
// actually need to branch on (session.ts's isTransportDeadError-style
// checks, and the UI's "re-enroll" vs "car unreachable" messaging):
//   session-gone — 404: the Pi doesn't know this session id (evict + retry
//     a full handshake).
//   timeout      — 504 (Pi-side BLE wait timed out) OR our own client-side
//     AbortController firing (Pi never responded at all).
//   ble          — 502: the Pi reached the point of talking BLE and the
//     radio/car errored.
//   auth         — 401/403: bearer token wrong or revoked; UI should send
//     the user to re-enroll.
//   network       — fetch itself rejected for a non-abort reason (DNS,
//     TLS/cert, connection refused — Pi unreachable or URL misconfigured).
//   http         — any other non-2xx status.
export type TransportErrorKind = 'session-gone' | 'timeout' | 'ble' | 'auth' | 'http' | 'network';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status?: number;

  constructor(kind: TransportErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.status = status;
  }
}

// PiConfig is the shape a future config.ts owns for persistence; defined
// here (not re-derived from PiClient's constructor arg) so callers have one
// import site for "what does a saved Pi connection look like."
export interface PiConfig {
  baseUrl: string;
  token: string;
  vin?: string;
}

// --- Injectable fetch --------------------------------------------------
//
// Only the slice of the Fetch API PiClient actually touches: enough to be
// satisfied structurally by the real global `fetch`/`Response` (so the
// default arg needs no wrapper) AND by a tiny hand-built object in tests
// (so tests never need a real network stack, a Response polyfill, or real
// timers — see transport.test.ts and the "deterministic timeouts" note
// below).
export interface PiResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export interface PiRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}
export type PiFetch = (url: string, init: PiRequestInit) => Promise<PiResponseLike>;

// --- Safety guard (P1.T6 runtime half) ----------------------------------
//
// The Pi's base URL is USER-CONFIGURED (LAN IP or a Tailscale Funnel
// hostname), so there is no fixed allowlist to check it against — the guard
// that actually holds the "never reach Tesla's real servers" line is a
// denylist on the configured host, plus a hard require for https. The
// denylist + host-checking logic itself lives in ./teslaHostGuard (the one
// file in src/ble allowed to spell Tesla hostnames out plainly — see its
// header comment and the exclusion list in no-tesla-servers.test.ts).
//
// --- Timeouts ------------------------------------------------------------
//
// Matches the browser reference's per-path budget (app.js:42-53): opening a
// BLE session is a real Pi-side scan+connect and can legitimately take
// 8-15s on a cold radio, so it gets a generous budget; a warm /exchange
// gets the caller's own Pi-side BLE timeout (timeoutMs) plus a buffer for
// HTTP overhead; everything else (pairing/token/vin management) is a plain
// request/response with no BLE wait baked in.
const OPEN_SESSION_TIMEOUT_MS = 45_000;
const EXCHANGE_TIMEOUT_BUFFER_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const API_PREFIX = '/api/ble';

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base + suffix;
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && (e as { name?: unknown }).name === 'AbortError';
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

// --- Response shapes off the wire (snake_case, per the Pi's JSON) --------
interface OpenSessionResponse {
  session_id: string;
  vin: string;
}
interface ExchangeResponse {
  response_b64: string;
}
interface PairInfoResponse {
  vin: string;
  paired: boolean;
  public_key_pem: string;
}
interface TokenInfoResponse {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export class PiClient implements PiTransport {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: PiFetch;

  constructor(cfg: { baseUrl: string; token: string }, fetchImpl?: PiFetch) {
    assertPiBaseUrl(cfg.baseUrl);
    this.baseUrl = cfg.baseUrl.endsWith('/') ? cfg.baseUrl.slice(0, -1) : cfg.baseUrl;
    this.token = cfg.token;
    // Default to the ambient global fetch. Cast needed because the DOM lib's
    // `fetch`/`Response` types are structurally wider (and use
    // RequestInfo|URL/RequestInit) than the minimal PiFetch surface this
    // class actually calls through — the real fetch satisfies PiFetch at
    // runtime, TS just can't see that without help.
    this.fetchImpl = fetchImpl ?? ((globalThis.fetch as unknown) as PiFetch);
  }

  // request is the single call site all nine endpoints funnel through: it
  // builds the bearer+JSON request, runs it under a per-call AbortController
  // timeout, and maps the response to either a parsed body or a typed
  // TransportError. Timeout is INJECTED per call (not read off `this`) so
  // each endpoint can pick its own budget (see OPEN_SESSION_TIMEOUT_MS /
  // EXCHANGE_TIMEOUT_BUFFER_MS / DEFAULT_TIMEOUT_MS above).
  //
  // Deterministic testing: the timeout is a plain `setTimeout(..., timeoutMs)`
  // against the AbortController — nothing here is hardcoded to real wall-clock
  // waits. Tests get determinism for free via node:test's mock timers
  // (`t.mock.timers.enable({ apis: ['setTimeout'] })` + `t.mock.timers.tick(ms)`),
  // which patch the global setTimeout/clearTimeout this method calls. Future
  // transport-adjacent tasks needing a deterministic timeout should reuse that
  // pattern rather than inventing a configurable-timeout constructor knob.
  private async request<T>(method: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
    const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let res: PiResponseLike;
    try {
      res = await this.fetchImpl(url, { method, headers, body: jsonBody, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (isAbortError(e)) {
        throw new TransportError('timeout', `Pi did not respond within ${timeoutMs}ms — ${method} ${path}`);
      }
      throw new TransportError('network', `network error reaching the Pi — ${errMsg(e)}`);
    }
    clearTimeout(timer);

    if (res.status === 204) return null as T;

    // Read the body once; use it to enrich the error message when present,
    // but the STATUS (not the body) always decides the error kind.
    const text = await res.text();
    let bodyErrorMessage: string | undefined;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (parsed && typeof parsed.error === 'string') bodyErrorMessage = parsed.error;
      } catch {
        // Non-JSON body (or JSON without an `error` string) — fall through
        // to the status-based default message.
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new TransportError('auth', bodyErrorMessage ?? 'unauthorized — token revoked or wrong', res.status);
    }
    if (res.status === 404) {
      throw new TransportError('session-gone', bodyErrorMessage ?? 'session not found', res.status);
    }
    if (res.status === 504) {
      throw new TransportError('timeout', bodyErrorMessage ?? 'Pi-side timeout waiting on BLE', res.status);
    }
    if (res.status === 502) {
      throw new TransportError('ble', bodyErrorMessage ?? 'BLE error on the Pi', res.status);
    }
    if (!res.ok) {
      throw new TransportError('http', bodyErrorMessage ?? `HTTP ${res.status}`, res.status);
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  // --- PiTransport --------------------------------------------------------

  async openSession(vin: string): Promise<string> {
    const json = await this.request<OpenSessionResponse>(
      'POST',
      `${API_PREFIX}/sessions`,
      { vin },
      OPEN_SESSION_TIMEOUT_MS,
    );
    return json.session_id;
  }

  async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    // payloadB64/response_b64 are already-base64 strings end to end — the
    // engine (session.ts) base64s the frame before calling exchange and
    // base64-decodes the result; this method must NOT re-encode either side.
    const json = await this.request<ExchangeResponse>(
      'POST',
      `${API_PREFIX}/sessions/${sessionId}/exchange`,
      { payload_b64: payloadB64, timeout_ms: timeoutMs },
      timeoutMs + EXCHANGE_TIMEOUT_BUFFER_MS,
    );
    return json.response_b64;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request<null>('DELETE', `${API_PREFIX}/sessions/${sessionId}`, undefined, DEFAULT_TIMEOUT_MS);
  }

  // --- Enrollment / pairing superset --------------------------------------

  async pairInfo(): Promise<{ vin: string; paired: boolean; publicKeyPem: string }> {
    const json = await this.request<PairInfoResponse>('GET', `${API_PREFIX}/pair`, undefined, DEFAULT_TIMEOUT_MS);
    return { vin: json.vin, paired: json.paired, publicKeyPem: json.public_key_pem };
  }

  async setVin(vin: string): Promise<void> {
    await this.request<{ vin: string }>('PUT', `${API_PREFIX}/vin`, { vin }, DEFAULT_TIMEOUT_MS);
  }

  async enrollPublicKey(publicKeyB64: string): Promise<void> {
    await this.request<{ requested: boolean }>(
      'POST',
      `${API_PREFIX}/pair/external-pubkey`,
      { public_key_b64: publicKeyB64 },
      DEFAULT_TIMEOUT_MS,
    );
  }

  async tokenInfo(): Promise<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }> {
    const json = await this.request<TokenInfoResponse>('GET', `${API_PREFIX}/token`, undefined, DEFAULT_TIMEOUT_MS);
    return {
      id: json.id,
      name: json.name,
      createdAt: json.created_at,
      lastUsedAt: json.last_used_at,
      revokedAt: json.revoked_at,
    };
  }

  async revokeToken(): Promise<void> {
    await this.request<null>('DELETE', `${API_PREFIX}/token`, undefined, DEFAULT_TIMEOUT_MS);
  }
}
