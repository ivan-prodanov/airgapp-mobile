import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { sendNavigationFromExtension } from './extensionEntry.ts';

// The engine is driven entirely by the three functions the host injects, so a
// fake host is a complete test double for the extension's runtime — no JSC, no
// device, no car.
type Host = {
  __openSession?: unknown;
  __exchange?: unknown;
  __closeSession?: unknown;
};
const g = globalThis as unknown as Host;

const SCALAR = 'a'.repeat(64); // 32 bytes of hex — a valid P-256 scalar

function clearHost() {
  delete g.__openSession;
  delete g.__exchange;
  delete g.__closeSession;
}

describe('sendNavigationFromExtension', () => {
  beforeEach(clearHost);

  it('fails cleanly when the host injected nothing', async () => {
    // The realistic Swift bug: the context is created but the transport functions
    // were never installed. Must be a result, not a thrown error across the
    // bridge, or it is undiagnosable from the Swift side.
    const r = await sendNavigationFromExtension({
      vin: '5YJ3E1EA7KF000316',
      lat: 42.6977,
      lon: 23.3219,
      privateScalarHex: SCALAR,
    });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'failed');
    assert.match(r.reason ?? '', /did not inject/);
  });

  it('reports a transport failure as retryable, never as a refusal', async () => {
    // Unreachable is the condition that clears on its own next time you are near
    // the car. Calling it a refusal would drop the place permanently.
    g.__openSession = async () => {
      throw new Error('pi unreachable');
    };
    g.__exchange = async () => '';
    g.__closeSession = async () => {};

    const r = await sendNavigationFromExtension({
      vin: '5YJ3E1EA7KF000316',
      lat: 42.6977,
      lon: 23.3219,
      privateScalarHex: SCALAR,
    });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'failed', 'retryable, not terminal');
  });

  it('never throws across the bridge, whatever the host does', async () => {
    g.__openSession = () => {
      throw new Error('synchronous explosion');
    };
    g.__exchange = async () => '';
    g.__closeSession = async () => {};

    await assert.doesNotReject(async () => {
      const r = await sendNavigationFromExtension({
        vin: '5YJ3E1EA7KF000316',
        lat: 1,
        lon: 2,
        privateScalarHex: SCALAR,
      });
      assert.equal(r.verdict, 'failed');
    });
  });

  it('rejects a malformed private scalar as a failure rather than crashing', async () => {
    g.__openSession = async () => 'sess';
    g.__exchange = async () => '';
    g.__closeSession = async () => {};

    const r = await sendNavigationFromExtension({
      vin: '5YJ3E1EA7KF000316',
      lat: 1,
      lon: 2,
      privateScalarHex: 'not-hex',
    });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'failed');
  });
});

describe('the bridge symbol', () => {
  beforeEach(clearHost);

  it('is installed on the global object and returns JSON', async () => {
    const bridge = (globalThis as unknown as { airgappSendNavigation?: (s: string) => Promise<string> })
      .airgappSendNavigation;
    assert.equal(typeof bridge, 'function', 'Swift calls this by name');

    const out = JSON.parse(await bridge!(JSON.stringify({ vin: 'V', lat: 1, lon: 2, privateScalarHex: SCALAR })));
    assert.equal(out.ok, false);
    assert.equal(out.verdict, 'failed', 'no host injected in this test');
  });

  it('returns a result object for malformed JSON instead of throwing', async () => {
    const bridge = (globalThis as unknown as { airgappSendNavigation: (s: string) => Promise<string> })
      .airgappSendNavigation;
    const out = JSON.parse(await bridge('{{ not json'));
    assert.equal(out.ok, false);
    assert.equal(out.verdict, 'failed');
    assert.ok(out.reason, 'says why, so Swift can log something useful');
  });
});
