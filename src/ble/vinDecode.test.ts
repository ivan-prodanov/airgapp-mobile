import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vinToModelLine } from './vinDecode';

test('vinToModelLine maps the Tesla line char (position 4)', () => {
  assert.equal(vinToModelLine('5YJSA1E26MF000000'), 'modelS'); // 4th char S
  assert.equal(vinToModelLine('5YJ3E1EA7LF000000'), 'model3'); // 4th char 3
  assert.equal(vinToModelLine('5YJXCBE22HF000000'), 'modelX'); // 4th char X
  assert.equal(vinToModelLine('7SAYGDEE9PF000000'), 'modelY'); // 4th char Y, newer WMI
});

test('vinToModelLine returns null for unknown line or malformed VIN', () => {
  assert.equal(vinToModelLine('5YJRA1E20KF000000'), null); // R (Roadster) — unsupported
  assert.equal(vinToModelLine('TOO-SHORT'), null);
  assert.equal(vinToModelLine(''), null);
});
