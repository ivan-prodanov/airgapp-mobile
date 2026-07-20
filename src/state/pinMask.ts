// PIN entry display rules, copied from the Tesla app (v4.58.0 `base.apk` → Hermes bundle, `PinInput`).
//
// The decompiled component keeps two pieces of state — the digits and a `maskAll` flag — and renders
//   bullet.repeat(pin.length - 1) + (maskAll ? bullet : pin[pin.length - 1])
// so every digit EXCEPT the most recently typed one is masked. `maskAll` is set false on a digit press
// (revealing that digit) and true on delete/submit, which means the reveal is state-driven, not on a
// timer: the last digit stays visible until the user types again, deletes, or submits.

export const PIN_LENGTH = 4;
// The exact glyph the app uses (SpecialCharacters.bullet = U+2022).
export const PIN_BULLET = '•';

// "4" → "4"; then a 5 → "•5"; then a 6 → "••6". With maskAll, every position is a bullet.
export function maskPin(pin: string, maskAll: boolean): string {
  if (pin.length === 0) {
    return '';
  }
  const head = PIN_BULLET.repeat(pin.length - 1);
  return head + (maskAll ? PIN_BULLET : pin[pin.length - 1]);
}

// Digits past the 4th are ignored (the keypad simply stops accepting input).
export function appendPinDigit(pin: string, digit: string): string {
  return pin.length >= PIN_LENGTH ? pin : pin + digit;
}

export function deletePinDigit(pin: string): string {
  return pin.slice(0, -1);
}
