import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { MemoryAuditSink } from '../src/audit.js';
import { TimelineStore } from '../src/timeline.js';
import { HIERARCHY_METADATA_KEY, type TaskEnvelope } from '../src/types.js';
import { ProofWorkerAdapter } from '../src/workers/proof-worker.js';

const token = 'smoke-controller-token';
const audit = new MemoryAuditSink();
const timeline = new TimelineStore();
const app = createApp({
  baseUrl: 'http://127.0.0.1:0',
  controllerToken: token,
  worker: new ProofWorkerAdapter(),
  audit,
  timeline,
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve smoke-test server port.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  if (health.status !== 'ok') {
    throw new Error('Health check failed.');
  }
  const agentCard = await fetch(`${baseUrl}/.well-known/agent-card.json`).then(
    (response) => response.json(),
  );
  if (!agentCard.securitySchemes?.controllerBearer) {
    throw new Error('Agent Card does not advertise controller Bearer authentication.');
  }

  const catalog = await fetch(`${baseUrl}/ui-api/catalog`).then((response) => response.json());
  if (!Array.isArray(catalog.providers) || catalog.providers.length < 2) {
    throw new Error('Model catalog did not expose the configured providers.');
  }
  const draftResponse = await fetch(`${baseUrl}/ui-api/drafts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'deepseek-harness',
      objective: 'Draft only. Do not call an external model.',
      modelId: 'unselected',
      tier: 'unselected',
      precision: '严谨',
      reasoningEffort: '高',
      role: 'worker',
      permission: 'read-only',
    }),
  });
  const draft = await draftResponse.json();
  if (!draftResponse.ok || draft.requiresExplicitAuthorization !== true) {
    throw new Error('Draft did not require explicit authorization.');
  }
  if (draft.externalModelCalled !== false) {
    throw new Error('Creating a draft must not call an external model.');
  }
  const timelineBody = await fetch(`${baseUrl}/ui-api/timeline`).then((response) => response.json());
  if (!timelineBody.events?.some((event: { type?: string }) => event.type === 'worker.authorization.waiting')) {
    throw new Error('Draft did not produce a visible worker authorization message.');
  }

  const denied = await fetch(`${baseUrl}/a2a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'denied', method: 'GetExtendedAgentCard' }),
  });
  if (denied.status !== 401) {
    throw new Error(`Expected unauthorized request to return 401, got ${denied.status}.`);
  }

  const taskId = randomUUID();
  const objective = 'Verify the hierarchical A2A delegation path.';
  const envelope: TaskEnvelope = {
    protocolVersion: '0.1',
    taskId,
    issuedBy: { id: 'codex-controller', role: 'controller', client: 'codex' },
    assignedTo: { id: 'proof-worker', role: 'worker', client: 'local-proof' },
    objective,
    authority: {
      controllerId: 'codex-controller',
      workerRole: 'worker',
      allowedWorkerMessages: ['status', 'result', 'question', 'permission_request', 'failure'],
    },
    permissions: {
      workspaceMode: 'read-only',
      allowedRoots: [],
      network: 'none',
      destructiveActions: 'require-human-approval',
    },
    acceptanceCriteria: ['Return a completed A2A task with a text artifact.'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: `smoke-${taskId}`,
  };

  const response = await fetch(`${baseUrl}/a2a`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'A2A-Version': '1.0',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'smoke-task',
      method: 'SendMessage',
      params: {
        message: {
          messageId: randomUUID(),
          role: 'ROLE_USER',
          parts: [{ text: objective, mediaType: 'text/plain' }],
          metadata: { [HIERARCHY_METADATA_KEY]: envelope },
        },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`A2A request failed: ${JSON.stringify(body)}`);
  }

  const task = body.result?.task;
  if (task?.status?.state !== 'TASK_STATE_COMPLETED') {
    throw new Error(`Expected completed task, got: ${JSON.stringify(body)}`);
  }
  if (!task.artifacts?.[0]?.parts?.[0]?.text) {
    throw new Error('Completed task did not contain a text artifact.');
  }
  if (!audit.entries.some((entry) => entry.event === 'task.completed')) {
    throw new Error('Audit log did not record task completion.');
  }

  console.log(JSON.stringify({
    health,
    agentCardSecurity: Object.keys(agentCard.securitySchemes),
    providerCount: catalog.providers.length,
    draftRequiresAuthorization: draft.requiresExplicitAuthorization,
    draftExternalModelCalled: draft.externalModelCalled,
    workerConversationVisible: true,
    unauthorizedStatus: denied.status,
    taskId,
    finalState: task.status.state,
    artifact: task.artifacts[0].parts[0].text,
    auditEvents: audit.entries.map((entry) => entry.event),
  }, null, 2));
} finally {
  server.close();
  await once(server, 'close');
}
