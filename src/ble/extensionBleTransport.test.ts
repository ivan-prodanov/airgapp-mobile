import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { ExtensionBleTransport } from './extensionBleTransport.ts';
import { frameMessage } from './bleFraming.ts';
import { bytesToBase64, base64ToBytes } from './bytes.ts';
import { RoutableMessage } from './proto.ts';

// Builds a RoutableMessage the correlators can actually reason about. Correlation
// is the whole point of this transport, so a fake "frame" of random bytes would
// test nothing that matters.
function routable(opts: { uuid?: Uint8Array; requestUuid?: Uint8Array; routingAddress?: Uint8Array }): Uint8Array {
  return RoutableMessage.encode(
    RoutableMessage.create({
      uuid: opts.uuid ?? new Uint8Array(),
      requestUuid: opts.requestUuid ?? new Uint8Array(),
      toDestination: opts.routingAddress ? { routingAddress: opts.routingAddress } : undefined,
    }),
  ).finish();
}

interface Host {
  __bleConnect?: unknown;
  __bleWrite?: unknown;
  __bleDisconnect?: unknown;
  __onBleFrame?: (b64: string) => void;
}
const host = globalThis as unknown as Host;

let written: Uint8Array[] = [];

function installHost(blockLength = 20): void {
  written = [];
  host.__bleConnect = async () => blockLength;
  host.__bleWrite = async (b64: string) => {
    written.push(base64ToBytes(b64));
  };
  host.__bleDisconnect = async () => {};
}

// Deliver a whole message the way Swift would: raw notification chunks.
function deliver(payload: Uint8Array, chunk = 20): void {
  const framed = frameMessage(payload);
  for (let i = 0; i < framed.length; i += chunk) {
    host.__onBleFrame?.(bytesToBase64(framed.slice(i, i + chunk)));
  }
}

describe('ExtensionBleTransport', () => {
  beforeEach(() => installHost());

  it('returns the frame that answers the request, not merely the next one', async () => {
    const t = new ExtensionBleTransport();
    await t.openSession('5YJ3E1EA7KF000316');

    const reqUuid = new Uint8Array([1, 2, 3, 4]);
    const request = routable({ uuid: reqUuid });

    const pending = t.exchange('s', bytesToBase64(request), 2000);

    // An UNSOLICITED frame arrives first — a passive-entry challenge or a status
    // push. Returning this would hand the engine someone else's message as the
    // answer to its command, which is the failure this whole design prevents.
    deliver(routable({ uuid: new Uint8Array([9, 9, 9, 9]) }));
    // Then the real answer.
    deliver(routable({ requestUuid: reqUuid, uuid: new Uint8Array([5, 5]) }));

    const gotB64 = await pending;
    const got = RoutableMessage.decode(base64ToBytes(gotB64));
    assert.deepEqual(Array.from(got.requestUuid ?? []), [1, 2, 3, 4], 'must be the correlated reply');
  });

  it('times out rather than returning an unrelated frame', async () => {
    const t = new ExtensionBleTransport();
    await t.openSession('vin');
    const request = routable({ uuid: new Uint8Array([7, 7]) });
    const pending = t.exchange('s', bytesToBase64(request), 120);
    deliver(routable({ uuid: new Uint8Array([4, 4]) })); // never answers it
    await assert.rejects(pending, /timed out/);
  });

  it('chunks the write to the negotiated block length', async () => {
    installHost(23);
    const t = new ExtensionBleTransport();
    await t.openSession('vin');
    const request = routable({ uuid: new Uint8Array(60).fill(3) });
    const pending = t.exchange('s', bytesToBase64(request), 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(written.length > 1, 'a message longer than one block must be split');
    assert.ok(
      written.every((w) => w.length <= 23),
      'no chunk may exceed the block length the car negotiated',
    );
    await pending.catch(() => {}); // it will time out; we only care about the write
  });

  it('reassembles a reply split across notifications', async () => {
    const t = new ExtensionBleTransport();
    await t.openSession('vin');
    const reqUuid = new Uint8Array([8, 8, 8]);
    const pending = t.exchange('s', bytesToBase64(routable({ uuid: reqUuid })), 2000);
    // 4-byte notifications: the reply spans many, as it does on a real link.
    deliver(routable({ requestUuid: reqUuid, uuid: new Uint8Array(40).fill(1) }), 4);
    const got = RoutableMessage.decode(base64ToBytes(await pending));
    assert.deepEqual(Array.from(got.requestUuid ?? []), [8, 8, 8]);
  });

  it('refuses to send a message larger than the car accepts', async () => {
    const t = new ExtensionBleTransport();
    await t.openSession('vin');
    const huge = bytesToBase64(new Uint8Array(2000));
    await assert.rejects(t.exchange('s', huge, 100), /too large/);
  });

  it('drops frames that arrived before the request went out', async () => {
    const t = new ExtensionBleTransport();
    await t.openSession('vin');
    const reqUuid = new Uint8Array([2, 2]);
    // A frame that WOULD correlate, but arrives before we ever wrote the request.
    // Answering from it would mean replaying a stale reply as a fresh one.
    deliver(routable({ requestUuid: reqUuid }));
    await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(t.exchange('s', bytesToBase64(routable({ uuid: reqUuid })), 120), /timed out/);
  });
});
