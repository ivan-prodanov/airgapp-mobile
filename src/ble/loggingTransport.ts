import { logw, timed } from '../services/logbus';
import type { CarTransport } from './types';

// Wraps a CarTransport to log the timing of every openSession / exchange /
// closeSession — WITHOUT touching the frozen session/crypto core.
//
// This is where the real latency lives: transport.openSession(vin) is the BLE
// scan + connect (the ~6s cold tax), and exchange() is the round-trip to the
// car. Timing them here answers "why was that command slow, and over which
// transport" straight from the pulled log.
//
// `name` is 'ble' | 'pi' so every line is attributable to a transport.
export function withTransportLogging(name: string, inner: CarTransport): CarTransport {
  return {
    openSession(vin: string) {
      // openSession = BLE scan+connect+link (the slow part). Cold vs warm shows
      // up directly in `ms`.
      return timed('txp', 'openSession', () => inner.openSession(vin), { txp: name });
    },
    exchange(sessionId: string, payloadB64: string, timeoutMs: number) {
      return timed('txp', 'exchange', () => inner.exchange(sessionId, payloadB64, timeoutMs), {
        txp: name,
        bytes: payloadB64.length,
        timeoutMs,
      });
    },
    async closeSession(sessionId: string) {
      try {
        await timed('txp', 'closeSession', () => Promise.resolve(inner.closeSession(sessionId)), { txp: name });
      } catch (e) {
        // Close failures are usually benign (session already gone); log, never throw.
        logw('txp', 'closeSession failed', { txp: name, err: String(e) });
      }
    },
  };
}
