import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appendPinDigit, deletePinDigit, maskPin, PIN_BULLET } from './pinMask';

// The behaviour Ivan called out: type 4 → "4"; type 5 after it → "•5" (NOT "4•••" or "•••5").
test('only the most recently typed digit is visible', () => {
  assert.equal(maskPin('4', false), '4');
  assert.equal(maskPin('45', false), `${PIN_BULLET}5`);
  assert.equal(maskPin('456', false), `${PIN_BULLET}${PIN_BULLET}6`);
  assert.equal(maskPin('4567', false), `${PIN_BULLET}${PIN_BULLET}${PIN_BULLET}7`);
});

// maskAll is set on delete/submit — then even the last digit is hidden.
test('maskAll hides every digit including the last', () => {
  assert.equal(maskPin('4', true), PIN_BULLET);
  assert.equal(maskPin('4567', true), PIN_BULLET.repeat(4));
});

test('an empty PIN renders nothing (the caller shows the placeholder instead)', () => {
  assert.equal(maskPin('', false), '');
  assert.equal(maskPin('', true), '');
});

test('the keypad stops accepting input past 4 digits', () => {
  assert.equal(appendPinDigit('', '1'), '1');
  assert.equal(appendPinDigit('123', '4'), '1234');
  assert.equal(appendPinDigit('1234', '5'), '1234');
});

test('delete removes the last digit and is safe when empty', () => {
  assert.equal(deletePinDigit('1234'), '123');
  assert.equal(deletePinDigit('1'), '');
  assert.equal(deletePinDigit(''), '');
});
