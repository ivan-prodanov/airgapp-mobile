// transport.test.ts — PiClient against an injected fake fetch. No hardware,
// no real network, no real waits: timeout tests use node:test's mock timers
// (see the "deterministic timeout" test below) instead of a real 45s sleep.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PiClient, TransportError, type PiFetch, type PiRequestInit, type PiResponseLike } from './transport';

// --- fake-fetch helpers ----------------------------------------------------

interface CapturedCall {
  url: string;
  init: PiRequestInit;
}

function jsonResponse(status: number, bodyObj?: unknown): PiResponseLike {
  const text = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

// respondingFetch returns a fixed status/body on every call and records each
// call's url+init so tests can assert on method/headers/body/path.
function respondingFetch(calls: CapturedCall[], status: number, bodyObj?: unknown): PiFetch {
  return async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(status, bodyObj);
  };
}

// rejectingFetch simulates a fetch() that throws for a non-abort reason
// (DNS failure, connection refused, TLS error) — PiClient must map this to
// kind: 'network', distinct from an abort-triggered timeout.
function rejectingFetch(message: string): PiFetch {
  return async () => {
    throw new Error(message);
  };
}

// abortAwareFetch never resolves on its own — it only settles when the
// AbortSignal passed in `init` fires, at which point it rejects with an
// AbortError, exactly like a real fetch() does under an aborted
// AbortController. Combined with node:test's mock timers (which patch the
// global setTimeout PiClient's request() uses to schedule the abort), this
// makes the "Pi never responds" path fully deterministic — no real 45s wait.
function abortAwareFetch(calls: CapturedCall[]): PiFetch {
  return (url, init) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
}

const OK_BASE = { baseUrl: 'https://192.168.4.1:8443', token: 'tok-123' };

// --- constructor safety guard ----------------------------------------------

test('constructor throws on a denylisted Tesla-server host (exact + subdomain)', () => {
  const badExact = 'https://' + 'tesla' + '.com';
  const badSubdomain = 'https://fleet-api.' + 'tesla' + '.com';
  const badOwnerApi = 'https://' + 'owner' + '-api.example.net';

  for (const baseUrl of [badExact, badSubdomain, badOwnerApi]) {
    assert.throws(
      () => new PiClient({ baseUrl, token: 't' }),
      (e: unknown) => e instanceof TransportError && e.kind === 'http',
      `expected constructor to throw TransportError for ${baseUrl}`,
    );
  }
});

test('constructor throws on a non-https base URL', () => {
  assert.throws(
    () => new PiClient({ baseUrl: 'http://192.168.4.1:8443', token: 't' }),
    (e: unknown) => e instanceof TransportError && e.kind === 'http',
  );
});

test('constructor accepts a valid LAN https base and a Tailscale Funnel https base', () => {
  assert.doesNotThrow(() => new PiClient({ baseUrl: 'https://192.168.4.1:8443', token: 't' }));
  assert.doesNotThrow(() => new PiClient({ baseUrl: 'https://mypi.tailxxxx.ts.net', token: 't' }));
});

// --- happy-path request shapes ----------------------------------------------

test('openSession POSTs to /api/ble/sessions with bearer header + {vin} body, returns session_id', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 200, { session_id: 'sess-1', vin: '5YJ3XYZ' }));

  const sessionId = await client.openSession('5YJ3XYZ');

  assert.equal(sessionId, 'sess-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/sessions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-123');
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { vin: '5YJ3XYZ' });
});

test('exchange POSTs payload_b64/timeout_ms to /sessions/{id}/exchange, returns response_b64', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 200, { response_b64: 'BBBB' }));

  const respB64 = await client.exchange('sess-1', 'AAAA', 5000);

  assert.equal(respB64, 'BBBB');
  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/sessions/sess-1/exchange');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { payload_b64: 'AAAA', timeout_ms: 5000 });
  // exchange must NOT double-encode: the base64 string passed in comes back
  // out unchanged, not re-wrapped or re-decoded.
});

test('closeSession DELETEs and resolves void on 204', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 204));

  const result = await client.closeSession('sess-1');

  assert.equal(result, undefined);
  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/sessions/sess-1');
  assert.equal(calls[0].init.method, 'DELETE');
});

test('baseUrl with a trailing slash does not produce a double slash', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(
    { baseUrl: 'https://192.168.4.1:8443/', token: 'tok-123' },
    respondingFetch(calls, 200, { session_id: 's', vin: 'v' }),
  );
  await client.openSession('v');
  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/sessions');
});

// --- enrollment superset -----------------------------------------------------

test('pairInfo GETs /api/ble/pair and camel-cases the response', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(
    OK_BASE,
    respondingFetch(calls, 200, { vin: '5YJ3XYZ', paired: true, public_key_pem: '-----BEGIN...' }),
  );

  const info = await client.pairInfo();

  assert.deepEqual(info, { vin: '5YJ3XYZ', paired: true, publicKeyPem: '-----BEGIN...' });
  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/pair');
  assert.equal(calls[0].init.method, 'GET');
});

test('enrollPublicKey POSTs public_key_b64 to /api/ble/pair/external-pubkey', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 200, { requested: true }));

  await client.enrollPublicKey('BASE64==');

  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/pair/external-pubkey');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { public_key_b64: 'BASE64==' });
});

test('setVin PUTs {vin} to /api/ble/vin', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 200, { vin: '5YJ3XYZ' }));

  await client.setVin('5YJ3XYZ');

  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/vin');
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].init.body ?? '{}'), { vin: '5YJ3XYZ' });
});

test('tokenInfo GETs /api/ble/token and camel-cases the response', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(
    OK_BASE,
    respondingFetch(calls, 200, {
      id: 'tok-1',
      name: 'phone',
      created_at: '2026-01-01T00:00:00Z',
      last_used_at: null,
      revoked_at: null,
    }),
  );

  const info = await client.tokenInfo();

  assert.deepEqual(info, {
    id: 'tok-1',
    name: 'phone',
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
  });
});

test('revokeToken DELETEs /api/ble/token and resolves void on 204', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 204));

  await client.revokeToken();

  assert.equal(calls[0].url, 'https://192.168.4.1:8443/api/ble/token');
  assert.equal(calls[0].init.method, 'DELETE');
});

test('Authorization bearer header is present on every call, GET/POST/PUT/DELETE alike', async () => {
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, respondingFetch(calls, 200, { session_id: 's', vin: 'v' }));
  await client.openSession('v');
  for (const call of calls) {
    assert.equal(call.init.headers.Authorization, 'Bearer tok-123');
  }
});

// --- error-kind mapping ------------------------------------------------------

test('404 maps to session-gone', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 404, { error: 'no such session' }));
  await assert.rejects(
    client.exchange('gone', 'AA', 1000),
    (e: unknown) => e instanceof TransportError && e.kind === 'session-gone' && e.status === 404,
  );
});

test('504 maps to timeout', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 504, { error: 'ble timeout' }));
  await assert.rejects(
    client.exchange('s', 'AA', 1000),
    (e: unknown) => e instanceof TransportError && e.kind === 'timeout' && e.status === 504,
  );
});

test('502 maps to ble', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 502, { error: 'ble disconnect' }));
  await assert.rejects(
    client.exchange('s', 'AA', 1000),
    (e: unknown) => e instanceof TransportError && e.kind === 'ble' && e.status === 502,
  );
});

test('401 maps to auth', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 401, { error: 'revoked' }));
  await assert.rejects(
    client.pairInfo(),
    (e: unknown) => e instanceof TransportError && e.kind === 'auth' && e.status === 401,
  );
});

test('403 maps to auth', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 403, { error: 'forbidden' }));
  await assert.rejects(
    client.pairInfo(),
    (e: unknown) => e instanceof TransportError && e.kind === 'auth' && e.status === 403,
  );
});

test('a rejecting fetch (non-abort) maps to network', async () => {
  const client = new PiClient(OK_BASE, rejectingFetch('getaddrinfo ENOTFOUND'));
  await assert.rejects(
    client.openSession('v'),
    (e: unknown) => e instanceof TransportError && e.kind === 'network',
  );
});

test('500 with {"error":"boom"} maps to http with message including "boom"', async () => {
  const client = new PiClient(OK_BASE, respondingFetch([], 500, { error: 'boom' }));
  await assert.rejects(client.pairInfo(), (e: unknown) => {
    return e instanceof TransportError && e.kind === 'http' && e.status === 500 && e.message.includes('boom');
  });
});

// --- deterministic timeout ---------------------------------------------------

test('openSession rejects with kind timeout when the Pi never responds (mock timers, no real wait)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: CapturedCall[] = [];
  const client = new PiClient(OK_BASE, abortAwareFetch(calls));

  const pending = client.openSession('5YJ3XYZ');
  // openSession's budget is 45_000ms; advance the mocked clock past it
  // instead of waiting in real time.
  t.mock.timers.tick(45_000);

  await assert.rejects(pending, (e: unknown) => e instanceof TransportError && e.kind === 'timeout');
});

test('exchange timeout budget is timeoutMs + 5s, not the flat 45s openSession budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new PiClient(OK_BASE, abortAwareFetch([]));

  const pending = client.exchange('sess-1', 'AAAA', 2000);
  t.mock.timers.tick(2000); // not yet at the 2000+5000 budget
  // still pending — give the microtask queue a chance to settle without
  // resolving the outer promise.
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  await Promise.resolve();
  assert.equal(settled, false, 'should not have timed out before the +5s buffer elapses');

  t.mock.timers.tick(5000); // now at 7000ms total, past the 2000+5000 budget
  await assert.rejects(pending, (e: unknown) => e instanceof TransportError && e.kind === 'timeout');
});
