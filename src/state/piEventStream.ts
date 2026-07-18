// piEventStream.ts — WebSocket client that streams live VCSEC push frames
// from the Pi forwarder's /api/ble/sessions/{id}/events endpoint.
//
// This lives in src/state/ (not src/ble/) because it touches RN's global
// `WebSocket`, unlike the react-native-free protocol code in src/ble/. The
// socket is injected via `socketFactory` (default: real RN WebSocket) so
// this module stays node-testable with a fake socket — see
// piEventStream.test.ts and transport.ts's PiFetch for the same pattern.

import { base64ToBytes } from '../ble/bytes';

// MinimalSocket is the subset of RN's WebSocket we actually use: assignable
// on*/close handlers plus close(). The real global WebSocket satisfies this
// at runtime, so the default socketFactory needs no wrapper.
export interface MinimalSocket {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface PiEventStreamOptions {
  baseUrl: string;
  token: string;
  sessionId: string;
  onFrame: (frame: Uint8Array) => void;
  socketFactory?: (url: string) => MinimalSocket;
  onStatus?: (s: 'open' | 'closed') => void;
}

// eventsUrl swaps the http(s) scheme for ws(s) and builds the events path +
// bearer token query param.
function eventsUrl(baseUrl: string, sessionId: string, token: string): string {
  const wsBase = baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}/api/ble/sessions/${sessionId}/events?token=${encodeURIComponent(token)}`;
}

export function startPiEventStream(opts: PiEventStreamOptions): () => void {
  const { baseUrl, token, sessionId, onFrame, onStatus } = opts;
  const socketFactory =
    opts.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as MinimalSocket);

  const url = eventsUrl(baseUrl, sessionId, token);
  const sock = socketFactory(url);

  sock.onopen = () => {
    onStatus?.('open');
  };

  sock.onmessage = (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return; // malformed JSON — ignore
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'frame_b64' in parsed &&
      typeof (parsed as { frame_b64: unknown }).frame_b64 === 'string'
    ) {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes((parsed as { frame_b64: string }).frame_b64);
      } catch {
        return; // malformed base64 in an otherwise well-formed message — ignore
      }
      onFrame(bytes);
    }
  };

  sock.onclose = () => {
    onStatus?.('closed');
  };

  sock.onerror = () => {
    // No dedicated error status in the interface — onclose follows a
    // WebSocket error in practice, so nothing else to do here.
  };

  return () => {
    sock.close();
    sock.onopen = null;
    sock.onmessage = null;
    sock.onclose = null;
    sock.onerror = null;
  };
}
