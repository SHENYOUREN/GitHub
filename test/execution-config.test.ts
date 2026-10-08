import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('legacy workspace defaults migrate to the dedicated DeepSeek execution folder', () => {
  const directory = mkdtempSync(join(tmpdir(), 'execution-config-migrate-'));
  const file = join(directory, 'execution-config.json');
  try {
    writeFileSync(file, JSON.stringify({ workspaceRoot: 'D:\\GPT工作室' }), 'utf8');
    const store = new ExecutionConfigStore(file);
    assert.equal(store.get().workspaceRoot, 'D:\\GPT工作室\\执行端文件夹\\deepseek执行端');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('DSH sync snapshot persists only in the relay configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'execution-config-dsh-sync-'));
  const file = join(directory, 'execution-config.json');
  try {
    const store = new ExecutionConfigStore(file);
    store.update({
      dshSynced: {
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        modelName: 'deepseek-flash',
        reasoningEffort: 'high',
        source: 'session-last-used',
        sessionId: 'session-1',
        syncedAt: '2026-10-08T14:00:00.000Z',
      },
    });
    const reopened = new ExecutionConfigStore(file).get();
    assert.equal(reopened.dshSynced?.model, 'deepseek-flash');
    assert.equal(reopened.dshSynced?.reasoningEffort, 'high');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
