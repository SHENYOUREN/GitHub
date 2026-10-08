import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ExecutionConfigStore } from '../src/execution-config.js';

test('execution configuration persists across orchestrator restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-execution-config-'));
  try {
    const file = join(dir, 'execution-config.json');
    const store = new ExecutionConfigStore(file);
    store.update({
      providerId: 'deepseek-harness',
      modelId: 'dsh-current',
      reasoningEffort: 'medium',
      role: 'reviewer',
      permission: 'workspace-write',
      workspaceRoot: 'D:\\ExampleWorkspace',
    });

    const reopened = new ExecutionConfigStore(file).get();
    assert.equal(reopened.providerId, 'deepseek-harness');
    assert.equal(reopened.reasoningEffort, 'medium');
    assert.equal(reopened.role, 'reviewer');
    assert.equal(reopened.permission, 'workspace-write');
    assert.equal(reopened.workspaceRoot, 'D:\\ExampleWorkspace');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
