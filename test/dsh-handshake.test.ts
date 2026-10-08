import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshHandshakeService } from '../src/dsh-handshake.js';

test('DSH handshake launches the new session in the configured execution workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-handshake-cwd-'));
  const workspace = join(root, '执行端文件夹', 'deepseek执行端');
  const fakeBin = join(root, 'fake-dsh.mjs');
  writeFileSync(fakeBin, `
console.log(JSON.stringify({ type: 'session', sessionId: 'cwd-session', cwd: process.cwd() }));
console.log(JSON.stringify({ type: 'final', text: '我已链接:' + process.cwd() }));
`, 'utf8');
  try {
    mkdirSync(root, { recursive: true });
    const service = new DshHandshakeService(fakeBin, workspace);
    const result = await service.connect({ timeoutMs: 5_000, workspaceRoot: workspace });
    assert.equal(result.connected, true);
    assert.equal(result.sessionId, 'cwd-session');
    assert.equal(result.reply, `我已链接:${workspace}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
