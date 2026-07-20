import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recoveryView, recoveryTitle, recoverySubtitle } from './recoveryPresentation';

test('a healthy phone key leaves Home completely alone', () => {
  assert.deepEqual(recoveryView({ remedy: 'none', piConfigured: true }), {
    presentation: 'none',
    remedy: 'none',
  });
  assert.deepEqual(recoveryView({ remedy: 'none', piConfigured: false }), {
    presentation: 'none',
    remedy: 'none',
  });
});

test('WITH a Pi the menus survive a bond wedge — they still work over the Pi', () => {
  // The whole point of diverging from the official app: hiding rows that
  // demonstrably work would be a lie to the user.
  const v = recoveryView({ remedy: 'forget-bluetooth-device', piConfigured: true });
  assert.equal(v.presentation, 'banner');
});

test('WITHOUT a Pi we take over the screen, exactly like the official app', () => {
  // BLE-only install: a wedge means nothing works, so offering the rows WOULD
  // be the lie. Same reasoning, opposite conclusion.
  const v = recoveryView({ remedy: 'forget-bluetooth-device', piConfigured: false });
  assert.equal(v.presentation, 'takeover');
});

test('a wiped key with a Pi is ALSO only a banner', () => {
  // Re-enrollment needs a card tap at the car, but the Pi keeps every remote
  // control working meanwhile — no reason to blank the menu.
  const v = recoveryView({ remedy: 're-enroll-with-card', piConfigured: true });
  assert.equal(v.presentation, 'banner');
  assert.equal(v.remedy, 're-enroll-with-card');
});

test('the remedy survives the presentation decision unchanged', () => {
  // Presentation must never rewrite WHAT the user has to do — that is the one
  // way this layer could send someone for their key card over a bond wedge.
  for (const piConfigured of [true, false]) {
    assert.equal(
      recoveryView({ remedy: 'forget-bluetooth-device', piConfigured }).remedy,
      'forget-bluetooth-device',
    );
    assert.equal(
      recoveryView({ remedy: 're-enroll-with-card', piConfigured }).remedy,
      're-enroll-with-card',
    );
  }
});

test('copy matches the remedy, never the other way round', () => {
  assert.equal(recoveryTitle('re-enroll-with-card'), 'Set Up Phone Key');
  assert.equal(recoveryTitle('forget-bluetooth-device'), 'Reconnect Bluetooth');
  // A bond wedge must NOT inherit the official app's "Set Up Phone Key" framing:
  // it makes the user think their key is gone and reach for the card.
  assert.doesNotMatch(recoveryTitle('forget-bluetooth-device'), /Set Up/);
  assert.match(recoverySubtitle('re-enroll-with-card'), /passive entry/);
});
