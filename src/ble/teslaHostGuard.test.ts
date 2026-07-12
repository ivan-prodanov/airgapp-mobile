// teslaHostGuard.test.ts — direct coverage for every TESLA_HOST_MARKERS
// entry (transport.test.ts only exercised 3 of the 5 pre-refactor markers
// via string-concatenated test input; this file covers all of them, plus
// tesla.cn, with plain hostnames as input).
//
// This file legitimately needs to reference Tesla hostnames as plain test
// input, so — like teslaHostGuard.ts itself — it is excluded from the
// no-tesla-servers.test.ts literal scan (see EXCLUDED_FILES there).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertPiBaseUrl, TESLA_HOST_MARKERS } from './teslaHostGuard';
import { TransportError } from './transport';

test('TESLA_HOST_MARKERS includes tesla.cn (Tesla China)', () => {
  assert.ok(TESLA_HOST_MARKERS.includes('tesla.cn'));
});

test('assertPiBaseUrl throws for every denylisted Tesla-server host', () => {
  const badUrls = [
    'https://owner-api.teslamotors.com',
    'https://fleet-api.prd.na.vn.cloud.tesla.com',
    'https://auth.tesla.com',
    'https://fleet-api.prd.cn.vn.cloud.tesla.cn',
    'https://tesla.cdn.akamai.net',
    'https://OWNER-API.TESLAMOTORS.COM', // uppercase
    'https://192.168.4.1@owner-api.tesla.com', // userinfo spoof
    'http://192.168.4.1:8443', // plain http
  ];

  for (const baseUrl of badUrls) {
    assert.throws(
      () => assertPiBaseUrl(baseUrl),
      (e: unknown) => e instanceof TransportError && e.kind === 'http',
      `expected assertPiBaseUrl to throw for ${baseUrl}`,
    );
  }
});

test('assertPiBaseUrl allows a valid LAN https base and a Tailscale Funnel https base', () => {
  assert.doesNotThrow(() => assertPiBaseUrl('https://192.168.4.1:8443'));
  assert.doesNotThrow(() => assertPiBaseUrl('https://myhost.ts.net'));
});
