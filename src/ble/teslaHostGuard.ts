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

// assertHostAllowed is the pure, extracted check assertPiBaseUrl runs once it
// has a (protocol, hostname) pair. Pulled out so it's directly testable
// without needing to coerce the real `URL` implementation into producing an
// empty hostname (which may not even be reachable on every URL polyfill).
//
// FAIL CLOSED: an empty/falsy hostname is rejected here, unconditionally,
// BEFORE the denylist loop — never treated as "no match found, so allow."
// This matters because on Hermes `URL` may be missing or partial (the app
// entry MUST load `react-native-url-polyfill` — see P2.T0 — so hostname is
// reliable on device); if a partial `URL` impl ever parses without throwing
// but yields an empty hostname, `''.includes('tesla.com')` is false, which
// would otherwise let a Tesla host silently PASS the guard (fail-OPEN,
// defeating the "never reach Tesla's real servers" constraint). Throwing
// here means "we couldn't prove this host is safe" is treated the same as
// "this host is denylisted."
export function assertHostAllowed(protocol: string, hostname: string): void {
  if (protocol !== 'https:') {
    throw new TransportError(
      'http',
      `Pi base URL must be https: (got ${protocol}) — a plain-http base would leak the bearer token`,
    );
  }
  const host = hostname.toLowerCase();
  if (!host) {
    // Fail closed — a missing/partial URL impl must never let a host
    // through unchecked; see the file-level comment above.
    throw new TransportError('http', 'refusing to configure transport for a Pi base URL with an empty hostname');
  }
  for (const marker of TESLA_HOST_MARKERS) {
    if (host.includes(marker)) {
      throw new TransportError('http', `refusing to configure transport for a Tesla-server host: ${host}`);
    }
  }
}

// assertPiBaseUrl parses baseUrl and throws a TransportError('http', …) if:
//   - `new URL` throws (fail closed — see assertHostAllowed's comment), or
//   - the protocol isn't https: (a plain-http base would leak the bearer
//     token), or
//   - the hostname is empty (fail closed), or
//   - the hostname (NOT the raw string — so userinfo `@`-spoofs like
//     `https://192.168.4.1@owner-api.tesla.com` can't sneak a denylisted
//     host past a naive substring check on the full URL) matches any
//     TESLA_HOST_MARKERS entry, case-insensitively.
export function assertPiBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    // Fail closed — a `URL` that can't parse must never be treated as
    // allowed; see assertHostAllowed's comment.
    throw new TransportError('http', `invalid Pi base URL: ${JSON.stringify(baseUrl)}`);
  }
  assertHostAllowed(url.protocol, url.hostname);
}
