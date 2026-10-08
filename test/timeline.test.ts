import assert from 'node:assert/strict';
import test from 'node:test';
import { TimelineStore } from '../src/timeline.js';

test('timeline subscribers receive events and listAfter returns only newer records', () => {
  const store = new TimelineStore();
  const received: string[] = [];
  const unsubscribe = store.subscribe((event) => received.push(event.id));
  const first = store.add({ type: 'one', kind: 'status', actor: 'system', title: 'one', state: 'info' });
  const second = store.add({ type: 'two', kind: 'reasoning', actor: 'worker', title: 'two', state: 'info' });
  unsubscribe();
  store.add({ type: 'three', kind: 'tool', actor: 'worker', title: 'three', state: 'info' });
  assert.deepEqual(received, [first.id, second.id]);
  assert.deepEqual(store.listAfter(first.id).map((event) => event.type), ['two', 'three']);
});

test('timeline records can be removed individually or cleared', () => {
  const store = new TimelineStore();
  const first = store.add({ type: 'one', kind: 'status', actor: 'system', title: 'one', state: 'info' });
  store.add({ type: 'two', kind: 'status', actor: 'system', title: 'two', state: 'info' });
  assert.equal(store.remove(first.id), true);
  assert.deepEqual(store.list().map((event) => event.type), ['two']);
  assert.equal(store.clear(), 1);
  assert.deepEqual(store.list(), []);
});
