import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TimelineStore } from '../src/timeline.js';

test('timeline can persist execution history across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a2a-timeline-'));
  try {
    const file = join(dir, 'timeline.json');
    const store = new TimelineStore(10, file);
    store.add({ type: 'worker.reasoning', kind: 'reasoning', actor: 'worker', title: 'thinking', detail: 'step one', state: 'info', metadata: { taskId: 't1' } });
    const reopened = new TimelineStore(10, file);
    assert.equal(reopened.list().length, 1);
    assert.equal(reopened.list()[0]?.metadata?.taskId, 't1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
