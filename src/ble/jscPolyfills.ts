// jscPolyfills — the host globals JavaScriptCore lacks, supplied in JS so the
// Swift side does not have to.
//
// Imported first by extensionEntry, before anything that might use them at module
// scope. protobufjs calls TextDecoder at LOAD time and throws without it — found
// by the bundle's bare-context check, which is the only place that failure was
// ever going to show up before the device.
//
// Everything here is feature-DETECTED: if a future JSC provides these natively,
// the native one wins. A polyfill that unconditionally overwrites a working
// built-in is how you end up debugging a slower, subtly-different implementation
// of something that already worked.
//
// Deliberately NOT in Swift. Every symbol the Swift host must install is another
// thing that can be forgotten, mis-implemented, or silently differ between the
// app and the extension — and UTF-8 conversion is pure computation with no reason
// to cross the bridge. The Swift contract stays down to the four things only
// Swift can do: three transport calls and a CSPRNG.

interface PolyfillTarget {
  TextEncoder?: unknown;
  TextDecoder?: unknown;
}

const target = globalThis as unknown as PolyfillTarget;

// UTF-8 encode. Handles the surrogate PAIRS a naive implementation gets wrong:
// an emoji or any astral-plane character arrives as two UTF-16 code units, and
// encoding them separately produces mojibake rather than a failure — the kind of
// bug that only shows up on the one destination name containing an emoji.
class PolyfillTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i += 1) {
      let code = input.charCodeAt(i);
      // High surrogate followed by a low surrogate → one code point.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
        const next = input.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
          i += 1;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  }
}

// UTF-8 decode. Malformed input yields U+FFFD rather than throwing, matching the
// standard's non-fatal default — this decodes bytes that came off a car over BLE,
// and a throw there would take out a send rather than mangle one character.
class PolyfillTextDecoder {
  readonly encoding = 'utf-8';

  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (!input) return '';
    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);

    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i];
      let code: number;
      let size: number;
      if (b0 < 0x80) {
        code = b0;
        size = 1;
      } else if ((b0 & 0xe0) === 0xc0) {
        code = b0 & 0x1f;
        size = 2;
      } else if ((b0 & 0xf0) === 0xe0) {
        code = b0 & 0x0f;
        size = 3;
      } else if ((b0 & 0xf8) === 0xf0) {
        code = b0 & 0x07;
        size = 4;
      } else {
        out += '�';
        i += 1;
        continue;
      }
      if (i + size > bytes.length) {
        out += '�';
        break;
      }
      let valid = true;
      for (let k = 1; k < size; k += 1) {
        const cont = bytes[i + k];
        if ((cont & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        code = (code << 6) | (cont & 0x3f);
      }
      if (!valid) {
        out += '�';
        i += 1;
        continue;
      }
      i += size;
      if (code > 0xffff) {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else {
        out += String.fromCharCode(code);
      }
    }
    return out;
  }
}

if (typeof target.TextEncoder === 'undefined') target.TextEncoder = PolyfillTextEncoder;
if (typeof target.TextDecoder === 'undefined') target.TextDecoder = PolyfillTextDecoder;

export { PolyfillTextEncoder, PolyfillTextDecoder };
