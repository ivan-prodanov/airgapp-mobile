import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPiEventStream } from './piEventStream';
import { bytesToBase64 } from '../ble/bytes';

// FakeSocket implements the MinimalSocket subset of RN's WebSocket so tests
// never touch a real socket: startPiEventStream assigns onopen/onmessage/
// onclose/onerror handlers and calls .close(); the emit* helpers below let a
// test drive those handlers as if the server had spoken.
class FakeSocket {
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }

  emitClose() {
    this.onclose?.();
  }
}

test('a frame_b64 message is base64-decoded and handed to onFrame', () => {
  let sock: FakeSocket;
  const frames: Uint8Array[] = [];
  const stop = startPiEventStream({
    baseUrl: 'https://pi.example',
    token: 't',
    sessionId: 'S1',
    onFrame: (f) => frames.push(f),
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  // URL is the wss events endpoint with the token query param
  assert.match(sock!.url, /^wss:\/\/pi\.example\/api\/ble\/sessions\/S1\/events\?token=t$/);
  sock!.emitOpen();
  sock!.emitMessage(JSON.stringify({ frame_b64: bytesToBase64(new Uint8Array([1, 2, 3])) }));
  assert.deepEqual(Array.from(frames[0]), [1, 2, 3]);
  stop();
  assert.equal(sock!.closed, true);
});

test('a message with no frame_b64 field does not call onFrame or throw', () => {
  let sock: FakeSocket;
  const frames: Uint8Array[] = [];
  startPiEventStream({
    baseUrl: 'https://pi.example',
    token: 't',
    sessionId: 'S1',
    onFrame: (f) => frames.push(f),
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  sock!.emitOpen();
  assert.doesNotThrow(() => sock!.emitMessage(JSON.stringify({})));
  assert.equal(frames.length, 0);
});

test('a non-JSON message does not call onFrame or throw', () => {
  let sock: FakeSocket;
  const frames: Uint8Array[] = [];
  startPiEventStream({
    baseUrl: 'https://pi.example',
    token: 't',
    sessionId: 'S1',
    onFrame: (f) => frames.push(f),
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  sock!.emitOpen();
  assert.doesNotThrow(() => sock!.emitMessage('not json at all'));
  assert.equal(frames.length, 0);
});
