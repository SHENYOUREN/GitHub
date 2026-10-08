import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlStateStore } from '../src/control-state.js';

test('starts with the room disabled and worker asleep', () => {
  const store = new ControlStateStore();
  assert.deepEqual(store.get(), { roomEnabled: false, workerAwake: false });
});

test('requires the room before the worker can be awakened', () => {
  const store = new ControlStateStore();
  assert.throws(() => store.update({ workerAwake: true }), /room_must_be_enabled/);
  assert.deepEqual(store.update({ roomEnabled: true, workerAwake: true }), {
    roomEnabled: true,
    workerAwake: true,
  });
  assert.deepEqual(store.update({ roomEnabled: false }), {
    roomEnabled: false,
    workerAwake: false,
  });
});
