import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerSessionStore } from '../src/worker-session.js';

test('worker session reports connected state after registration and offline after disconnect', () => {
  const store = new WorkerSessionStore(60_000);
  assert.equal(store.get().connected, false);
  const connected = store.update({ clientName: 'DSH', model: 'deepseek', sessionId: 'worker-1', state: 'busy' });
  assert.equal(connected.connected, true);
  assert.equal(connected.state, 'busy');
  assert.equal(store.disconnect().connected, false);
});
