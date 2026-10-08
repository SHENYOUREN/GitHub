import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { MemoryAuditSink } from '../src/audit.js';
import { ControlStateStore } from '../src/control-state.js';
import { ControllerSessionStore } from '../src/controller-session.js';
import { ExecutionConfigStore } from '../src/execution-config.js';
import { TimelineStore } from '../src/timeline.js';
import { WorkerSessionStore } from '../src/worker-session.js';
import { HIERARCHY_METADATA_KEY, type TaskEnvelope } from '../src/types.js';
import { ProofWorkerAdapter } from '../src/workers/proof-worker.js';

const token = 'smoke-controller-token';
const audit = new MemoryAuditSink();
const timeline = new TimelineStore();
const controlState = new ControlStateStore();
const controllerSession = new ControllerSessionStore();
const executionConfig = new ExecutionConfigStore();
const workerSession = new WorkerSessionStore();
const app = createApp({
  baseUrl: 'http://127.0.0.1:0',
  controllerToken: token,
  worker: new ProofWorkerAdapter(),
  audit,
  timeline,
  controlState,
  controllerSession,
  executionConfig,
  workerSession,
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

  const blockedDraft = await fetch(`${baseUrl}/ui-api/drafts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'local-proof', objective: 'Must remain blocked.' }),
  });
  if (blockedDraft.status !== 409) {
    throw new Error('Draft was not blocked while the room and worker switches were off.');
  }

  const blockedFormalTask = await fetch(`${baseUrl}/client-api/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Must not queue while the room is off.' }),
  });
  if (blockedFormalTask.status !== 409) {
    throw new Error('Formal ChatGPT task was not blocked while the room and worker switches were off.');
  }
  const blockedControllerMessage = await fetch(`${baseUrl}/client-api/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'message', detail: 'Must not dispatch while the room is off.' }),
  });
  if (blockedControllerMessage.status !== 409) {
    throw new Error('Controller message was not blocked while the room and worker switches were off.');
  }
  const enabledState = await fetch(`${baseUrl}/ui-api/control-state`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomEnabled: true, workerAwake: true }),
  }).then((response) => response.json());
  if (!enabledState.roomEnabled || !enabledState.workerAwake) {
    throw new Error('Control switches did not enable the room and worker.');
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
  if (!draftResponse.ok || draft.externalModelCalled !== false) {
    throw new Error('Development draft must stay local and must not call an external model.');
  }

  const sessionResponse = await fetch(`${baseUrl}/client-api/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ clientName: 'ChatGPT', model: 'smoke-model', conversationId: 'smoke-conversation', state: 'busy' }),
  });
  const controllerSessionSnapshot = await sessionResponse.json();
  if (!sessionResponse.ok || !controllerSessionSnapshot.connected) {
    throw new Error('ChatGPT controller session did not register.');
  }

  const workerSessionResponse = await fetch(`${baseUrl}/worker-api/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ clientName: 'DeepSeek Harness', model: 'smoke-deepseek', sessionId: 'smoke-worker', state: 'idle' }),
  });
  const workerSessionSnapshot = await workerSessionResponse.json();
  if (!workerSessionResponse.ok || !workerSessionSnapshot.connected) {
    throw new Error('DeepSeek worker session did not register.');
  }

  const configResponse = await fetch(`${baseUrl}/ui-api/execution-config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek-harness', modelId: 'dsh-current', reasoningEffort: 'high' }),
  });
  const executionConfigSnapshot = await configResponse.json();
  if (!configResponse.ok || executionConfigSnapshot.providerId !== 'deepseek-harness') {
    throw new Error('Execution configuration was not stored.');
  }

  const formalTaskResponse = await fetch(`${baseUrl}/client-api/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Snapshot config', objective: 'Verify task-scoped execution settings.' }),
  });
  const formalTaskBody = await formalTaskResponse.json();
  if (!formalTaskResponse.ok || formalTaskBody.task?.role !== 'worker' || formalTaskBody.task?.permission !== 'read-only') {
    throw new Error(`Formal task did not snapshot execution settings: ${JSON.stringify(formalTaskBody)}`);
  }
  await fetch(`${baseUrl}/ui-api/execution-config`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek-harness', modelId: 'dsh-current', reasoningEffort: 'medium', role: 'reviewer', permission: 'workspace-write' }),
  });
  const taskSnapshotResponse = await fetch(`${baseUrl}/worker-api/tasks/${formalTaskBody.task.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const taskSnapshot = await taskSnapshotResponse.json();
  if (!taskSnapshotResponse.ok || taskSnapshot.role !== 'worker' || taskSnapshot.permission !== 'read-only' || taskSnapshot.reasoningEffort !== 'high') {
    throw new Error(`Task-scoped configuration changed after global config changed: ${JSON.stringify(taskSnapshot)}`);
  }

  const unknownWorkerTaskEvent = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'reasoning', detail: 'Bad task reference.', metadata: { taskId: 'missing-task' } }),
  });
  if (unknownWorkerTaskEvent.status !== 404) throw new Error('Worker event with an unknown taskId was not rejected.');

  const questionResponse = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'question', detail: 'Need an answer.', metadata: { taskId: formalTaskBody.task.id } }),
  });
  const questionBody = await questionResponse.json();
  if (!questionResponse.ok || questionBody.task?.status !== 'waiting-user') throw new Error('Worker question did not move the task to waiting-user.');
  const lateReasoningResponse = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'reasoning', detail: 'Late buffered reasoning.', metadata: { taskId: formalTaskBody.task.id } }),
  });
  const lateReasoningBody = await lateReasoningResponse.json();
  if (lateReasoningBody.task?.status !== 'waiting-user') throw new Error('Late worker reasoning incorrectly cleared waiting-user state.');
  const controllerAnswerResponse = await fetch(`${baseUrl}/client-api/events`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'message', detail: 'Controller answer.', metadata: { taskId: formalTaskBody.task.id } }),
  });
  const controllerAnswerBody = await controllerAnswerResponse.json();
  if (!controllerAnswerResponse.ok || controllerAnswerBody.task?.status !== 'running') throw new Error('Controller answer did not resume a waiting task.');
  const cancelledFormal = await fetch(`${baseUrl}/ui-api/tasks/${formalTaskBody.task.id}/control`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
  }).then((response) => response.json());
  if (cancelledFormal.task?.status !== 'cancelled') throw new Error('Formal task did not enter cancelled state.');
  const lateResultResponse = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'result', state: 'success', detail: 'Late final result.', metadata: { taskId: formalTaskBody.task.id } }),
  });
  const lateResultBody = await lateResultResponse.json();
  if (lateResultBody.task?.status !== 'cancelled') throw new Error('Late worker result revived a cancelled task.');

  const workerEventResponse = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'reasoning', detail: 'Worker-provided reasoning stream sample.' }),
  });
  if (!workerEventResponse.ok) throw new Error('Worker event bridge rejected a reasoning event.');

  const interventionResponse = await fetch(`${baseUrl}/ui-api/interventions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Only inspect the web UI.' }),
  });
  if (!interventionResponse.ok) throw new Error('Agent-window direct intervention was not recorded.');

  const demoResponse = await fetch(`${baseUrl}/ui-api/demo/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objective: 'Exercise the mock DeepSeek workflow.' }),
  });
  const demoBody = await demoResponse.json();
  if (!demoResponse.ok || demoBody.externalModelCalled !== false) throw new Error('Demo mode did not start locally.');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const pausedDemo = await fetch(`${baseUrl}/ui-api/tasks/${demoBody.task.id}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) }).then((response) => response.json());
  if (pausedDemo.task?.status !== 'paused') throw new Error('Demo task did not pause.');
  const resumedDemo = await fetch(`${baseUrl}/ui-api/tasks/${demoBody.task.id}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) }).then((response) => response.json());
  if (resumedDemo.task?.status !== 'running') throw new Error('Demo task did not resume.');
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const waitingTasks = await fetch(`${baseUrl}/ui-api/tasks`).then((response) => response.json());
  const demoWaiting = waitingTasks.tasks?.find((task: { id?: string }) => task.id === demoBody.task.id);
  if (demoWaiting?.status !== 'waiting-user') throw new Error(`Demo task did not enter waiting-user state: ${JSON.stringify(demoWaiting)}`);
  const pauseWhileWaiting = await fetch(`${baseUrl}/ui-api/tasks/${demoBody.task.id}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) });
  if (pauseWhileWaiting.status !== 409) throw new Error('A waiting-user task should not be pauseable; it is already waiting.');
  const demoAnswer = await fetch(`${baseUrl}/ui-api/interventions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: demoBody.task.id, message: 'Inspect the execution-agent window first.' }),
  }).then((response) => response.json());
  if (!demoAnswer.demoResumed) throw new Error('Demo task did not resume after user reply.');
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const finishedTasks = await fetch(`${baseUrl}/ui-api/tasks`).then((response) => response.json());
  const demoFinished = finishedTasks.tasks?.find((task: { id?: string }) => task.id === demoBody.task.id);
  if (demoFinished?.status !== 'completed') throw new Error(`Demo task did not complete: ${JSON.stringify(demoFinished)}`);

  const formalPauseResponse = await fetch(`${baseUrl}/client-api/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Pause on room close', objective: 'Verify a live formal task pauses when the room closes.' }),
  });
  const formalPauseBody = await formalPauseResponse.json();
  if (!formalPauseResponse.ok) throw new Error(`Formal pause task did not start: ${JSON.stringify(formalPauseBody)}`);
  const formalPauseRunResponse = await fetch(`${baseUrl}/worker-api/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'reasoning', detail: 'Formal task is running before room shutdown.', metadata: { taskId: formalPauseBody.task.id } }),
  });
  const formalPauseRunBody = await formalPauseRunResponse.json();
  if (!formalPauseRunResponse.ok || formalPauseRunBody.task?.status !== 'running') {
    throw new Error(`Formal pause task did not enter running state: ${JSON.stringify(formalPauseRunBody)}`);
  }

  const sleepDemoResponse = await fetch(`${baseUrl}/ui-api/demo/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objective: 'Pause automatically when the room closes.' }),
  });
  const sleepDemoBody = await sleepDemoResponse.json();
  if (!sleepDemoResponse.ok) throw new Error('Second demo did not start.');
  await new Promise((resolve) => setTimeout(resolve, 450));
  await fetch(`${baseUrl}/ui-api/control-state`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomEnabled: false }),
  });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const sleepTasks = await fetch(`${baseUrl}/ui-api/tasks`).then((response) => response.json());
  const sleepDemo = sleepTasks.tasks?.find((task: { id?: string }) => task.id === sleepDemoBody.task.id);
  if (sleepDemo?.status !== 'paused') throw new Error(`Running demo did not pause when the room closed: ${JSON.stringify(sleepDemo)}`);
  const formalPausedByRoom = sleepTasks.tasks?.find((task: { id?: string }) => task.id === formalPauseBody.task.id);
  if (formalPausedByRoom?.status !== 'paused') throw new Error(`Running formal task did not pause when the room closed: ${JSON.stringify(formalPausedByRoom)}`);
  await fetch(`${baseUrl}/ui-api/control-state`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomEnabled: true, workerAwake: true }),
  });

  const timelineBody = await fetch(`${baseUrl}/ui-api/timeline`).then((response) => response.json());
  if (!timelineBody.events?.some((event: { type?: string }) => event.type === 'human.intervention')) {
    throw new Error('Shared timeline did not contain the user intervention.');
  }
  if (!timelineBody.events?.some((event: { kind?: string }) => event.kind === 'reasoning')) {
    throw new Error('Shared timeline did not contain the worker reasoning event.');
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
    blockedWhileSwitchesOff: blockedDraft.status === 409 && blockedFormalTask.status === 409 && blockedControllerMessage.status === 409,
    controllerConnected: controllerSessionSnapshot.connected,
    workerConnected: workerSessionSnapshot.connected,
    executionProvider: executionConfigSnapshot.providerId,
    taskConfigSnapshotStable: taskSnapshot.role === 'worker' && taskSnapshot.permission === 'read-only',
    taskStateTransitionsProtected: lateResultBody.task?.status === 'cancelled',
    draftExternalModelCalled: draft.externalModelCalled,
    workerConversationVisible: true,
    demoTaskLifecycle: 'running -> paused -> running -> waiting-user -> completed',
    roomClosePausesDemo: sleepDemo?.status === 'paused',
    roomClosePausesFormal: formalPausedByRoom?.status === 'paused',
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
