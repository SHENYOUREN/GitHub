import assert from 'node:assert/strict';
import test from 'node:test';
import { assertControllerTask, parseControllerTask, PolicyError } from '../src/policy.js';
import type { TaskEnvelope } from '../src/types.js';

function envelope(): TaskEnvelope {
  return {
    protocolVersion: '0.1',
    taskId: 'task-1',
    issuedBy: { id: 'codex-controller', role: 'controller' },
    assignedTo: { id: 'deepseek-worker', role: 'worker' },
    objective: 'Review a bounded change.',
    authority: {
      controllerId: 'codex-controller',
      workerRole: 'worker',
      allowedWorkerMessages: ['status', 'result', 'question', 'permission_request', 'failure'],
    },
    permissions: {
      workspaceMode: 'read-only',
      network: 'none',
      destructiveActions: 'require-human-approval',
    },
    acceptanceCriteria: ['Return reproducible findings.'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

test('accepts a controller-owned worker task', () => {
  assert.doesNotThrow(() => assertControllerTask(envelope()));
});

test('rejects a task issued by a worker', () => {
  const value = envelope();
  value.issuedBy.role = 'worker';
  assert.throws(() => assertControllerTask(value), PolicyError);
});

test('rejects destructive authority without human approval', () => {
  const value = envelope();
  value.permissions.destructiveActions = 'require-human-approval';
  Object.assign(value.permissions, { destructiveActions: 'allow' });
  assert.throws(() => assertControllerTask(value), PolicyError);
});

test('rejects expired authorization', () => {
  const value = envelope();
  value.expiresAt = new Date(Date.now() - 1_000).toISOString();
  assert.throws(() => assertControllerTask(value), PolicyError);
});

test('rejects a structurally malformed task before policy evaluation', () => {
  const value = envelope() as unknown as Record<string, unknown>;
  delete value.permissions;
  assert.throws(() => parseControllerTask(value), PolicyError);
});
