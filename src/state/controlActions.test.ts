import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_ACTIONS, CONTROL_ACTION_ORDER, DEFAULT_FAVORITES, type ControlActionId } from './controlActions';

test('CONTROL_ACTION_ORDER lists every catalog action exactly once', () => {
  const ids = Object.keys(CONTROL_ACTIONS) as ControlActionId[];
  assert.equal(CONTROL_ACTION_ORDER.length, ids.length);
  assert.deepEqual([...CONTROL_ACTION_ORDER].sort(), [...ids].sort());
});

test('there are 16 actions', () => {
  assert.equal(Object.keys(CONTROL_ACTIONS).length, 16);
});

test('every action def id matches its catalog key', () => {
  for (const [key, def] of Object.entries(CONTROL_ACTIONS)) {
    assert.equal(def.id, key);
  }
});

test('DEFAULT_FAVORITES are five valid, distinct action ids', () => {
  assert.equal(DEFAULT_FAVORITES.length, 5);
  assert.equal(new Set(DEFAULT_FAVORITES).size, 5);
  for (const id of DEFAULT_FAVORITES) {
    assert.ok(CONTROL_ACTIONS[id], `unknown favorite ${id}`);
  }
});
