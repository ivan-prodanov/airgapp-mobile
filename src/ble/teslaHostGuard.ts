// teslaHostGuard.ts — the "never reach Tesla's real servers" runtime guard
// (P1.T6 runtime half) for PiClient's USER-CONFIGURED base URL (LAN IP or a
// Tailscale Funnel hostname — there is no fixed allowlist to check it
// against, so the guard is a denylist on the configured host, plus a hard
// require for https).
//
// This module is the one legitimate place in src/ble allowed to spell Tesla
// hostnames out plainly: no-tesla-servers.test.ts greps every other file
// under src/ble for these substrings (including comments) as an independent
// tripwire against a Tesla-server literal creeping in anywhere else. This
// file (and its test) are excluded from that scan — see the exclusion list
// in no-tesla-servers.test.ts. Do not reintroduce string-concatenation
// tricks here; the plain, greppable list below is what makes each marker
// coverable and auditable in the first place.

import { TransportError } from './transport';

export const TESLA_HOST_MARKERS: string[] = [
  'tesla.com',
  'teslamotors.com',
  'tesla.cn',
  'owner-api',
  'owners-api',
  'akamai',
];

// assertPiBaseUrl parses baseUrl and throws a TransportError('http', …) if:
//   - the protocol isn't https: (a plain-http base would leak the bearer
//     token), or
//   - the hostname (NOT the raw string — so userinfo `@`-spoofs like
//     `https://192.168.4.1@owner-api.tesla.com` can't sneak a denylisted
//     host past a naive substring check on the full URL) matches any
//     TESLA_HOST_MARKERS entry, case-insensitively.
export function assertPiBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TransportError('http', `invalid Pi base URL: ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol !== 'https:') {
    throw new TransportError(
      'http',
      `Pi base URL must be https: (got ${url.protocol}) — a plain-http base would leak the bearer token`,
    );
  }
  const host = url.hostname.toLowerCase();
  for (const marker of TESLA_HOST_MARKERS) {
    if (host.includes(marker)) {
      throw new TransportError('http', `refusing to configure transport for a Tesla-server host: ${host}`);
    }
  }
}
