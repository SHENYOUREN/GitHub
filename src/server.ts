import { resolve } from 'node:path';
import { createApp } from './app.js';
import { JsonLineAuditSink } from './audit.js';
import { CompositeAuditSink, TimelineStore } from './timeline.js';
import { ControlStateStore } from './control-state.js';
import { ControllerSessionStore } from './controller-session.js';
import { ExecutionConfigStore } from './execution-config.js';
import { DshSettingsReader } from './dsh-settings.js';
import { DshHandshakeService } from './dsh-handshake.js';
import { TaskStore } from './task-store.js';
import { WorkerSessionStore } from './worker-session.js';
import { ProofWorkerAdapter } from './workers/proof-worker.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4310', 10);
const controllerToken = process.env.CONTROLLER_TOKEN;

if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error('The MVP may only bind to the local loopback interface.');
}
if (!controllerToken) {
  throw new Error('Set CONTROLLER_TOKEN before starting the orchestrator.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const baseUrl = `http://${host}:${port}`;
const timeline = new TimelineStore(2000, resolve('data', 'timeline.json'));
const controlState = new ControlStateStore();
const controllerSession = new ControllerSessionStore();
const executionConfig = new ExecutionConfigStore(resolve('data', 'execution-config.json'));
const dshSettings = new DshSettingsReader();
const dshHandshake = new DshHandshakeService();
const tasks = new TaskStore(resolve('data', 'tasks.json'));
const interruptedTasks = tasks.failInterruptedOnStartup();
const workerSession = new WorkerSessionStore();
timeline.add({
  type: 'system.ready',
  actor: 'orchestrator',
  title: '中转站已启动',
  detail: '当前不会自动调用任何外部模型。',
  state: 'success',
  metadata: {
    channel: 'system',
    reasoningSummary: '系统启动检查已完成。',
    toolSummary: '本机服务已监听，外部模型连接保持关闭。',
  },
});
for (const task of interruptedTasks) {
  timeline.add({
    type: 'task.recovery.interrupted',
    kind: 'result',
    actor: 'orchestrator',
    title: '任务因中转站重启而中断',
    detail: task.lastSummary ?? '任务执行上下文未恢复。',
    state: 'error',
    metadata: { taskId: task.id, channel: 'system', visibility: 'both' },
  });
}
const app = createApp({
  baseUrl,
  controllerToken,
  worker: new ProofWorkerAdapter(),
  audit: new CompositeAuditSink([
    new JsonLineAuditSink(resolve('data', 'audit.jsonl')),
    timeline,
  ]),
  timeline,
  controlState,
  controllerSession,
  executionConfig,
  dshSettings,
  dshHandshake,
  tasks,
  workerSession,
});

app.listen(port, host, (error) => {
  if (error) {
    throw error;
  }
  console.log(`Hierarchical A2A orchestrator: ${baseUrl}`);
  console.log(`Agent card: ${baseUrl}/.well-known/agent-card.json`);
  console.log('Worker: proof-worker (local protocol proof)');
});
