import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshSettingsReader } from '../src/dsh-settings.js';

test('DSH settings reader extracts the agent default without reading credentials', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-settings-'));
  try {
    const profileDir = join(home, 'profiles', 'web');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: high\n- id: another-plugin\n`, 'utf8');
    const settings = new DshSettingsReader(home, 'D:\\AI工作区').get();
    assert.equal(settings.available, true);
    assert.equal(settings.provider, 'deepseek-official');
    assert.equal(settings.model, 'deepseek-flash');
    assert.equal(settings.reasoningEffort, 'high');
    assert.equal(settings.workspaceRoot, 'D:\\AI工作区');
    assert.equal(settings.source, 'profile-default');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('DSH settings reader prefers the newest session modelSelection.lastUsed', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-runtime-settings-'));
  try {
    const sessions = join(home, 'storages', 'session_projcache', 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, 'session-live.json'), JSON.stringify({ record: { rows: {
      modelSelection: { ver: 2, seq: 21, val: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } } },
    } } }), 'utf8');
    const settings = new DshSettingsReader(home).get();
    assert.equal(settings.source, 'session-last-used');
    assert.equal(settings.sessionId, 'session-live');
    assert.equal(settings.reasoningEffort, 'high');
    assert.equal(settings.workspaceRoot, 'D:\\GPT工作室\\执行端文件夹\\deepseek执行端');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
