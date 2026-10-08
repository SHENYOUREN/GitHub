import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { MemoryAuditSink } from '../src/audit.js';
import { ControlStateStore } from '../src/control-state.js';
import { ControllerSessionStore } from '../src/controller-session.js';
import { DshHandshakeService } from '../src/dsh-handshake.js';
import { DshSettingsReader } from '../src/dsh-settings.js';
import { ExecutionConfigStore } from '../src/execution-config.js';
import { TaskStore } from '../src/task-store.js';
import { TimelineStore } from '../src/timeline.js';
import { WorkerSessionStore } from '../src/worker-session.js';
import { ProofWorkerAdapter } from '../src/workers/proof-worker.js';

test('sync DSH settings updates only the relay snapshot and leaves the DSH profile untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sync-'));
  const profileDir = join(root, 'dsh', 'profiles', 'web');
  const configPath = join(root, 'execution-config.json');
  mkdirSync(profileDir, { recursive: true });
  const profilePath = join(profileDir, 'cordis.patch.yml');
  const profile = `- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: high\n`;
  writeFileSync(profilePath, profile, 'utf8');

  const app = createApp({
    baseUrl: 'http://127.0.0.1:0',
    controllerToken: 'sync-test-token-1234567890',
    worker: new ProofWorkerAdapter(),
    audit: new MemoryAuditSink(),
    timeline: new TimelineStore(),
    controlState: new ControlStateStore(),
    controllerSession: new ControllerSessionStore(),
    executionConfig: new ExecutionConfigStore(configPath),
    dshSettings: new DshSettingsReader(join(root, 'dsh')),
    dshHandshake: new DshHandshakeService(join(root, 'missing-dsh.mjs')),
    tasks: new TaskStore(),
    workerSession: new WorkerSessionStore(),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/ui-api/sync-dsh-settings`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.changedDsh, false);
    assert.equal(body.config.dshSynced.model, 'deepseek-flash');
    assert.equal(body.config.dshSynced.reasoningEffort, 'high');
    assert.equal(readFileSync(profilePath, 'utf8'), profile);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
