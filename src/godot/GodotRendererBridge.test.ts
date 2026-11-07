import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

import { initialVehicleState } from '../types/vehicleTypes';
import type { FrameData } from '../types/rendererMessages';

// The bridge imports the native ExpoGodotView module and (via vehicleStateAdapter) react-native,
// neither of which loads under plain node. Seed the require cache with stand-ins that record what
// the bridge queues for the engine and let the test play Godot's side of the bus.
const sent: string[] = [];
let toHost: ((event: { message: string }) => void) | null = null;

function stub(request: string, exports: unknown): void {
  const path = require.resolve(request);
  const mod = new Module(path);
  mod.exports = exports;
  mod.loaded = true;
  require.cache[path] = mod;
}
stub('react-native', { PixelRatio: { get: () => 3 } });
stub('../../modules/expo-godot-view', {
  ExpoGodotViewModule: {
    sendMessageToGodot: (json: string) => sent.push(json),
    addListener: (_event: string, listener: (event: { message: string }) => void) => {
      toHost = listener;
      return { remove: () => (toHost = null) };
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GodotRendererBridge } = require('./GodotRendererBridge') as typeof import('./GodotRendererBridge');

const frame = { width: 400, height: 800 } as unknown as FrameData;
const types = () => sent.map((json) => (JSON.parse(json) as { type: string }).type);
const count = (type: string) => types().filter((t) => t === type).length;
// moveCamera(…, false) asks for markers from a 0 ms timer; let it fire.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const fromGodot = (type: string) => toHost?.({ message: JSON.stringify({ type, data: {} }) });

beforeEach(() => {
  sent.length = 0;
});

test('GODOT_READY after boot() does not queue the scene a second time', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  bridge.boot(initialVehicleState, frame);
  await settle();
  const booted = sent.length;
  assert.equal(count('SHOW_PRODUCT'), 1);

  fromGodot('GODOT_READY');
  await settle();
  // boot()'s batch is still in the native queue: the engine only starts draining it on its first
  // _process, after every listener registered in _ready. Nothing needs re-sending.
  assert.deepEqual(types().slice(booted), []);
});

test('the boot batch asks for markers once', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  bridge.boot(initialVehicleState, frame);
  await settle();
  // Each request costs the engine a full viewport readback in the first car frame.
  assert.equal(count('GET_VEHICLE_MARKERS'), 1);
});

test('a GODOT_READY with no boot() queued ahead of it still re-applies the scene', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  fromGodot('GODOT_READY'); // engine up before the surface was laid out: nothing to apply yet
  await settle();
  assert.deepEqual(types(), []);

  bridge.boot(initialVehicleState, frame); // sent to a running engine, drained next frame
  await settle();
  const booted = sent.length;

  // Any later GODOT_READY means an engine that did not drain this bridge's batch.
  fromGodot('GODOT_READY');
  await settle();
  const resent = types().slice(booted);
  assert.ok(resent.includes('SHOW_PRODUCT'));
  assert.ok(resent.includes('SET_ENV_PARAMS'));
  assert.ok(resent.includes('MOVE_CAMERA'));
  assert.ok(resent.includes('SET_VEHICLE_LIGHTS'));
  assert.equal(resent.filter((t) => t === 'GET_VEHICLE_MARKERS').length, 1);
});

test('only the GODOT_READY that drains the boot batch is skipped', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  bridge.boot(initialVehicleState, frame);
  fromGodot('GODOT_READY');
  await settle();
  const afterFirst = sent.length;

  fromGodot('GODOT_READY');
  await settle();
  assert.ok(types().slice(afterFirst).includes('SHOW_PRODUCT'));
});

test('a foreground resync re-applies the scene and asks for markers once', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  bridge.boot(initialVehicleState, frame);
  fromGodot('GODOT_READY');
  await settle();
  const before = sent.length;

  bridge.resync('foreground');
  await settle();
  const resent = types().slice(before);
  assert.ok(resent.includes('SHOW_PRODUCT'));
  assert.ok(resent.includes('SET_VEHICLE_LIGHTS'));
  assert.equal(resent.filter((t) => t === 'GET_VEHICLE_MARKERS').length, 1);
});

test('switching to a different model asks for markers once', async () => {
  const bridge = new GodotRendererBridge();
  bridge.attach();
  bridge.boot(initialVehicleState, frame);
  await settle();
  const before = sent.length;

  bridge.switchVehicle({ ...initialVehicleState, carModel: initialVehicleState.carModel === 'model3' ? 'modelY' : 'model3' });
  await settle();
  const resent = types().slice(before);
  assert.ok(resent.includes('SHOW_PRODUCT'));
  assert.equal(resent.filter((t) => t === 'GET_VEHICLE_MARKERS').length, 1);
});
