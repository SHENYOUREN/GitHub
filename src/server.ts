import { resolve } from 'node:path';
import { createApp } from './app.js';
import { JsonLineAuditSink } from './audit.js';
import { CompositeAuditSink, TimelineStore } from './timeline.js';
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
const timeline = new TimelineStore();
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
const app = createApp({
  baseUrl,
  controllerToken,
  worker: new ProofWorkerAdapter(),
  audit: new CompositeAuditSink([
    new JsonLineAuditSink(resolve('data', 'audit.jsonl')),
    timeline,
  ]),
  timeline,
});

app.listen(port, host, (error) => {
  if (error) {
    throw error;
  }
  console.log(`Hierarchical A2A orchestrator: ${baseUrl}`);
  console.log(`Agent card: ${baseUrl}/.well-known/agent-card.json`);
  console.log('Worker: proof-worker (local protocol proof)');
});
