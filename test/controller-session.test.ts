import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerSessionStore } from '../src/controller-session.js';

test('controller session becomes connected after registration and can disconnect', () => {
  const store = new ControllerSessionStore(60_000);
  assert.equal(store.get().connected, false);
  const connected = store.update({ clientName: 'ChatGPT', model: 'GPT', conversationId: 'abc', state: 'busy' });
  assert.equal(connected.connected, true);
  assert.equal(connected.model, 'GPT');
  assert.equal(connected.state, 'busy');
  assert.equal(store.disconnect().connected, false);
});
