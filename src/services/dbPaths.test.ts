import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pushedDbDir } from './dbPaths';

// The real values expo-sqlite reports for `defaultDatabaseDirectory`.
const IOS = '/var/mobile/Containers/Data/Application/ABC-123/Documents/SQLite';
const ANDROID = '/data/user/0/local.airgapp.mobile/files/SQLite';

test('iOS resolves to the Documents dir the devicectl push targets', () => {
  assert.equal(pushedDbDir(IOS), '/var/mobile/Containers/Data/Application/ABC-123/Documents');
});

test('Android resolves to the app files dir that `run-as ... cp` targets', () => {
  // Android has no Documents container; expo-sqlite roots at filesDir instead. The same
  // suffix strip therefore lands on files/, which is what scripts/android/deploy-chargers.sh
  // writes to. If this ever stops matching the script, chargers silently vanish.
  assert.equal(pushedDbDir(ANDROID), '/data/user/0/local.airgapp.mobile/files');
});

test('a trailing slash is tolerated', () => {
  assert.equal(pushedDbDir(`${ANDROID}/`), '/data/user/0/local.airgapp.mobile/files');
});

test('undefined passes through so openDatabaseSync falls back to its default', () => {
  assert.equal(pushedDbDir(undefined), undefined);
});

test('a directory not ending in SQLite is left alone', () => {
  // Guards the regex against eating a path that merely CONTAINS "SQLite".
  assert.equal(pushedDbDir('/data/SQLite/app/files'), '/data/SQLite/app/files');
});
