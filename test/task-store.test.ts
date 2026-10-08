import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskStore } from '../src/task-store.js';

test('task history persists status, waiting reason, role, and permission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-task-store-'));
  try {
    const file = join(dir, 'tasks.json');
    const store = new TaskStore(file);
    const created = store.create({
      objective: 'Review the web UI.', source: 'demo', status: 'running', role: 'reviewer', permission: 'workspace-write',
    });
    store.update(created.id, { status: 'waiting-user', waitingReason: 'Choose the next page.' });

    const reopened = new TaskStore(file);
    const task = reopened.get(created.id);
    assert.equal(task?.status, 'waiting-user');
    assert.equal(task?.waitingReason, 'Choose the next page.');
    assert.equal(task?.role, 'reviewer');
    assert.equal(task?.permission, 'workspace-write');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('late worker progress cannot revive waiting or terminal tasks', () => {
  const store = new TaskStore();
  const task = store.create({ objective: 'Check state transitions.', source: 'chatgpt', status: 'running' });
  store.applyEventStatus(task.id, 'waiting-user', 'Need an answer.', 'worker');
  store.applyEventStatus(task.id, 'running', 'Late worker reasoning.', 'worker');
  assert.equal(store.get(task.id)?.status, 'waiting-user');

  store.applyEventStatus(task.id, 'running', 'Controller answered.', 'controller');
  assert.equal(store.get(task.id)?.status, 'running');

  store.update(task.id, { status: 'cancelled' });
  store.applyEventStatus(task.id, 'completed', 'Late final result.', 'worker');
  assert.equal(store.get(task.id)?.status, 'cancelled');
});

test('interrupted active tasks are marked failed during explicit startup recovery', () => {
  const store = new TaskStore();
  const running = store.create({ objective: 'Was running.', source: 'chatgpt', status: 'running' });
  const queued = store.create({ objective: 'Still queued.', source: 'chatgpt', status: 'queued' });
  const interrupted = store.failInterruptedOnStartup();
  assert.deepEqual(interrupted.map((task) => task.id), [running.id]);
  assert.equal(store.get(running.id)?.status, 'failed');
  assert.equal(store.get(queued.id)?.status, 'queued');
});
