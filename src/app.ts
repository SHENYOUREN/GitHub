import express, { type RequestHandler } from 'express';
import { resolve } from 'node:path';
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  type AgentCard,
} from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import { HierarchicalExecutor } from './executor.js';
import { modelProviders } from './catalog.js';
import type { ControlStateStore } from './control-state.js';
import type { ControllerSessionStore, ControllerSessionUpdate } from './controller-session.js';
import type { ExecutionConfigStore, ExecutionRole, WorkspacePermission } from './execution-config.js';
import type { DshSettingsReader } from './dsh-settings.js';
import type { DshHandshakeService } from './dsh-handshake.js';
import type { TimelineStore } from './timeline.js';
import { DemoRunner } from './demo-runner.js';
import { TaskStore, type TaskStatus } from './task-store.js';
import type { WorkerSessionStore, WorkerSessionUpdate } from './worker-session.js';
import type { AuditSink, TimelineKind, WorkerAdapter } from './types.js';

export interface AppOptions {
  baseUrl: string;
  controllerToken: string;
  worker: WorkerAdapter;
  audit: AuditSink;
  timeline?: TimelineStore;
  controlState: ControlStateStore;
  controllerSession: ControllerSessionStore;
  executionConfig: ExecutionConfigStore;
  dshSettings: DshSettingsReader;
  dshHandshake: DshHandshakeService;
  tasks?: TaskStore;
  workerSession: WorkerSessionStore;
}

function bearerGuard(expectedToken: string): RequestHandler {
  return (request, response, next) => {
    const header = request.header('authorization');
    if (header !== `Bearer ${expectedToken}`) {
      response.status(401).json({ error: 'controller_authorization_required' });
      return;
    }
    next();
  };
}

function text(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const timelineKinds = new Set<TimelineKind>([
  'message', 'reasoning', 'tool', 'result', 'status', 'question', 'permission_request',
]);

function timelineState(kind: TimelineKind, rawState: unknown) {
  if (rawState === 'waiting' || rawState === 'success' || rawState === 'error' || rawState === 'info') {
    return rawState;
  }
  if (kind === 'result') return 'success' as const;
  if (kind === 'question' || kind === 'permission_request') return 'waiting' as const;
  return 'info' as const;
}

function statusForEvent(kind: TimelineKind, rawState: unknown): TaskStatus | null {
  if (kind === 'result') return rawState === 'error' ? 'failed' : 'completed';
  if (kind === 'question' || kind === 'permission_request') return 'waiting-user';
  if (kind === 'reasoning' || kind === 'tool' || kind === 'message') return 'running';
  if (kind === 'status' && rawState === 'error') return 'failed';
  return null;
}

export function createApp(options: AppOptions) {
  if (!options.controllerToken) {
    throw new Error('controllerToken must not be empty.');
  }
  if (options.controllerToken.length < 16) {
    throw new Error('controllerToken must contain at least 16 characters.');
  }

  const agentCard: AgentCard = {
    name: 'Hierarchical A2A Orchestrator',
    description: 'Controller-owned task delegation for constrained worker agents.',
    supportedInterfaces: [
      {
        url: `${options.baseUrl}/a2a`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'SHENYOUREN',
      url: 'https://github.com/SHENYOUREN/GitHub',
    },
    version: '0.2.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {
      controllerBearer: {
        scheme: {
          $case: 'httpAuthSecurityScheme',
          value: {
            description: 'Opaque token held by the authorized controller.',
            scheme: 'Bearer',
            bearerFormat: 'opaque',
          },
        },
      },
    },
    securityRequirements: [{ schemes: { controllerBearer: { list: [] } } }],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'controlled-delegation',
        name: 'Controlled delegation',
        description: 'Delegate a bounded task from an authorized controller to a registered worker.',
        tags: ['orchestration', 'hierarchy', 'delegation'],
        examples: ['Review this repository against the supplied acceptance criteria.'],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
        securityRequirements: [{ schemes: { controllerBearer: { list: [] } } }],
      },
    ],
    documentationUrl: `${options.baseUrl}/docs`,
    signatures: [],
  };

  const taskStore = options.tasks ?? new TaskStore();
  const effectiveExecutionConfig = () => options.executionConfig.get();
  const demoRunner = options.timeline ? new DemoRunner(options.timeline, taskStore, options.executionConfig) : null;
  const dispatchReady = () => {
    const control = options.controlState.get();
    return control.roomEnabled && control.workerAwake;
  };

  const executor = new HierarchicalExecutor(options.worker, options.audit);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    executor,
  );
  const app = express();

  app.disable('x-powered-by');
  app.use('/ui-api', (request, response, next) => {
    const origin = request.header('origin');
    if (origin === 'http://127.0.0.1:3080' || origin === 'http://localhost:3080') {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    next();
  });
  app.use('/assets/icons', express.static(resolve('node_modules', 'lucide-static', 'icons')));
  app.use(express.static(resolve('public')));
  app.get('/agent', (_request, response) => response.sendFile(resolve('public', 'agent.html')));

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      protocol: A2A_PROTOCOL_VERSION,
      controller: options.controllerSession.get(),
      worker: {
        id: options.worker.id,
        kind: options.worker.kind,
        capabilities: options.worker.capabilities,
        session: options.workerSession.get(),
      },
    });
  });

  app.get('/api/agents', bearerGuard(options.controllerToken), (_request, response) => {
    response.json({
      controller: { id: 'chatgpt-controller', role: 'controller', session: options.controllerSession.get() },
      workers: [
        {
          id: options.worker.id,
          role: 'worker',
          kind: options.worker.kind,
          capabilities: options.worker.capabilities,
        },
      ],
    });
  });

  // ---- Web control room APIs -------------------------------------------------
  app.get('/ui-api/catalog', (_request, response) => {
    response.json({ providers: modelProviders });
  });
  app.get('/ui-api/execution-config', (_request, response) => {
    response.json(effectiveExecutionConfig());
  });
  app.get('/ui-api/dsh-settings', async (_request, response) => {
    response.json(await options.dshSettings.status());
  });
  app.post('/ui-api/sync-dsh-settings', (_request, response) => {
    const dsh = options.dshSettings.get();
    if (!dsh.available || !dsh.model) {
      response.status(503).json({ error: 'dsh_settings_unavailable', dsh });
      return;
    }
    const current = options.executionConfig.get();
    const syncedAt = new Date().toISOString();
    const next = options.executionConfig.update({
      providerId: 'deepseek-harness',
      modelId: 'dsh-current',
      reasoningEffort: dsh.reasoningEffort ?? current.reasoningEffort,
      dshSynced: {
        provider: dsh.provider,
        model: dsh.model,
        modelName: dsh.model,
        reasoningEffort: dsh.reasoningEffort,
        source: dsh.source,
        sessionId: dsh.sessionId,
        syncedAt,
      },
    });
    options.timeline?.add({
      type: 'worker.settings.synced', kind: 'status', actor: 'orchestrator', title: '已同步执行端设置',
      detail: `${dsh.provider ?? '默认服务商'} / ${dsh.model} · 推理 ${dsh.reasoningEffort ?? '默认'}`,
      state: 'success', metadata: { channel: 'system', visibility: 'both', syncedAt, readOnlySync: true },
    });
    response.json({ config: next, dsh, changedDsh: false });
  });
  app.post('/ui-api/dsh-window', (_request, response) => {
    const opened = options.dshHandshake.openWindow();
    response.status(opened ? 202 : 503).json({ opened });
  });
  app.patch('/ui-api/execution-config', express.json({ limit: '8kb' }), (request, response) => {
    const current = options.executionConfig.get();
    const providerId = typeof request.body?.providerId === 'string' ? request.body.providerId : current.providerId;
    const provider = modelProviders.find((item) => item.id === providerId);
    if (!provider) {
      response.status(400).json({ error: 'unknown_provider' });
      return;
    }
    const modelId = request.body?.modelId === null || typeof request.body?.modelId === 'string' ? request.body.modelId : current.modelId;
    if (modelId && provider.models.length && !provider.models.some((model) => model.id === modelId)) {
      response.status(400).json({ error: 'unknown_model' });
      return;
    }
    const model = provider.models.find((item) => item.id === modelId);
    const reasoningEffort = request.body?.reasoningEffort === null || typeof request.body?.reasoningEffort === 'string'
      ? request.body.reasoningEffort
      : current.reasoningEffort;
    if (reasoningEffort && model?.reasoningEfforts.length && !model.reasoningEfforts.includes(reasoningEffort)) {
      response.status(400).json({ error: 'unsupported_reasoning_effort' });
      return;
    }
    const role = ['worker', 'reviewer', 'researcher'].includes(request.body?.role)
      ? request.body.role as ExecutionRole
      : current.role;
    const permission = ['read-only', 'workspace-write'].includes(request.body?.permission)
      ? request.body.permission as WorkspacePermission
      : current.permission;
    const workspaceRoot = text(request.body?.workspaceRoot, 600) || current.workspaceRoot;
    const next = options.executionConfig.update({
      providerId,
      modelId,
      reasoningEffort,
      role,
      permission,
      workspaceRoot,
    });
    response.json(next);
  });
  app.get('/ui-api/timeline', (request, response) => {
    const after = typeof request.query.after === 'string' ? request.query.after : null;
    response.json({ events: options.timeline?.listAfter(after) ?? [] });
  });
  app.delete('/ui-api/timeline/:eventId', (request, response) => {
    if (!options.timeline?.remove(request.params.eventId)) {
      response.status(404).json({ error: 'timeline_event_not_found' });
      return;
    }
    response.json({ deleted: 1 });
  });
  app.delete('/ui-api/timeline', (_request, response) => {
    response.json({ deleted: options.timeline?.clear() ?? 0 });
  });
  app.get('/ui-api/controller-session', (_request, response) => {
    response.json(options.controllerSession.get());
  });
  app.get('/ui-api/worker-session', (_request, response) => {
    if (options.controlState.get().workerAwake && options.dshHandshake.isLinked()) options.workerSession.heartbeat();
    response.json(options.workerSession.get());
  });
  app.post('/ui-api/worker-handshake', async (_request, response) => {
    const control = options.controlState.get();
    if (!control.roomEnabled || !control.workerAwake) {
      response.status(409).json({ error: 'worker_not_awake' });
      return;
    }
    options.timeline?.add({
      type: 'worker.handshake.started', kind: 'status', actor: 'orchestrator', title: '正在创建 DSH 握手会话',
      detail: '只发送连接验证语，不包含工作任务。', state: 'waiting', metadata: { channel: 'system', visibility: 'both' },
    });
    const config = effectiveExecutionConfig();
    const result = await options.dshHandshake.connect({ workspaceRoot: config.workspaceRoot });
    if (!result.connected) {
      options.timeline?.add({
        type: 'worker.handshake.failed', kind: 'status', actor: 'orchestrator', title: 'DSH 握手未完成',
        detail: result.error ?? '未收到“我已链接”。', state: 'error', metadata: { channel: 'system', visibility: 'both' },
      });
      response.status(502).json(result);
      return;
    }
    const settings = options.dshSettings.get();
    const session = options.workerSession.update({ clientName: 'DeepSeek Harness', model: settings.model, sessionId: result.sessionId, state: 'idle' });
    options.timeline?.add({
      type: 'worker.handshake.completed', kind: 'message', actor: 'worker', title: '执行 Agent → 中转站',
      detail: result.reply, state: 'success', metadata: { channel: 'worker', visibility: 'both', sessionId: result.sessionId, handshake: true },
    });
    response.json({ ...result, session });
  });
  app.get('/ui-api/events', (request, response) => {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const send = (eventName: string, payload: unknown) => {
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send('snapshot', { events: options.timeline?.list() ?? [] });
    const unsubscribe = options.timeline?.subscribe((event) => send('timeline', event)) ?? (() => undefined);
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 15_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/ui-api/tasks', (_request, response) => {
    response.json({ tasks: taskStore.list() });
  });
  app.get('/ui-api/tasks/:taskId/events', (request, response) => {
    const taskId = request.params.taskId;
    const events = options.timeline?.list().filter((event) => event.metadata?.taskId === taskId) ?? [];
    response.json({ task: taskStore.get(taskId), events });
  });
  app.post('/ui-api/demo/start', express.json({ limit: '16kb' }), (request, response) => {
    const control = options.controlState.get();
    if (!control.roomEnabled || !control.workerAwake) {
      response.status(409).json({ error: 'worker_not_awake' });
      return;
    }
    if (!demoRunner) {
      response.status(503).json({ error: 'timeline_unavailable' });
      return;
    }
    const objective = text(request.body?.objective, 8_000) || '检查三界面任务室的执行窗口和任务历史交互。';
    const task = demoRunner.start(objective);
    response.status(201).json({ task, externalModelCalled: false, mode: 'demo' });
  });
  app.post('/ui-api/tasks/:taskId/control', express.json({ limit: '4kb' }), (request, response) => {
    const taskId = request.params.taskId;
    const task = taskStore.get(taskId);
    const action = request.body?.action;
    if (!task || !['pause', 'resume', 'cancel'].includes(action)) {
      response.status(400).json({ error: 'invalid_task_control' });
      return;
    }

    let handled = false;
    if (task.source === 'demo' && demoRunner) {
      handled = action === 'pause' ? demoRunner.pause(taskId) : action === 'resume' ? demoRunner.resume(taskId) : demoRunner.cancel(taskId);
    } else {
      if (action === 'pause' && task.status === 'running') {
        taskStore.update(taskId, { status: 'paused', waitingReason: null, lastSummary: '用户请求暂停任务。' }); handled = true;
      } else if (action === 'resume' && task.status === 'paused') {
        taskStore.update(taskId, { status: 'running', waitingReason: null, lastSummary: '用户请求继续任务。' }); handled = true;
      } else if (action === 'cancel' && !['completed', 'failed', 'cancelled'].includes(task.status)) {
        taskStore.update(taskId, { status: 'cancelled', waitingReason: null, lastSummary: '用户请求中止任务。' }); handled = true;
      }
      if (handled) {
        options.timeline?.add({
          type: `task.control.${action}`, kind: 'status', actor: 'human-owner', title: action === 'pause' ? '用户请求暂停任务' : action === 'resume' ? '用户请求继续任务' : '用户请求中止任务',
          detail: action === 'pause' ? '暂停当前执行，保留上下文等待继续。' : action === 'resume' ? '继续当前任务。' : '停止当前任务，不再继续执行。',
          state: action === 'cancel' ? 'error' : action === 'pause' ? 'waiting' : 'info',
          metadata: { taskId, channel: 'human', visibility: 'both', target: 'worker', controlAction: action },
        });
      }
    }
    if (!handled) {
      response.status(409).json({ error: 'task_control_rejected', task: taskStore.get(taskId) });
      return;
    }
    response.json({ task: taskStore.get(taskId), action, delivery: task.source === 'demo' ? 'demo-runner' : 'shared-timeline' });
  });

  app.get('/ui-api/control-state', (_request, response) => {
    response.json(options.controlState.get());
  });
  app.patch('/ui-api/control-state', express.json({ limit: '8kb' }), (request, response) => {
    const patch: { roomEnabled?: boolean; workerAwake?: boolean } = {};
    if (typeof request.body?.roomEnabled === 'boolean') patch.roomEnabled = request.body.roomEnabled;
    if (typeof request.body?.workerAwake === 'boolean') patch.workerAwake = request.body.workerAwake;
    const previous = options.controlState.get();
    try {
      const next = options.controlState.update(patch);
      if (previous.workerAwake && !next.workerAwake) {
        options.dshHandshake.reset();
        options.workerSession.disconnect();
        for (const task of taskStore.list()) {
          if (task.status !== 'running') continue;
          if (task.source === 'demo' && demoRunner) {
            demoRunner.pause(task.id);
            continue;
          }
          taskStore.update(task.id, { status: 'paused', waitingReason: null, lastSummary: '执行端休眠，任务已自动暂停。' });
          options.timeline?.add({
            type: 'task.control.pause', kind: 'status', actor: 'human-owner', title: '执行端休眠 · 任务自动暂停',
            detail: '任务室关闭或执行端被休眠，当前任务已暂停；重新唤醒后需要显式继续。', state: 'waiting',
            metadata: { taskId: task.id, channel: 'human', visibility: 'both', target: 'worker', controlAction: 'pause', automatic: true },
          });
        }
      }
      if (previous.roomEnabled !== next.roomEnabled) {
        options.timeline?.add({
          type: next.roomEnabled ? 'room.enabled' : 'room.disabled',
          kind: 'status',
          actor: 'human-owner',
          title: next.roomEnabled ? '多模型任务室已开启' : '多模型任务室已关闭',
          detail: next.roomEnabled ? '任务室开始接收 ChatGPT 与执行端的协作消息。' : '任务派发已停止，执行 Agent 已休眠。',
          state: next.roomEnabled ? 'success' : 'info',
          metadata: { channel: 'system', visibility: 'both' },
        });
      }
      if (previous.workerAwake !== next.workerAwake) {
        options.timeline?.add({
          type: next.workerAwake ? 'worker.awake' : 'worker.asleep',
          kind: 'status',
          actor: 'worker',
          title: next.workerAwake ? '执行 Agent 开始唤醒' : '执行 Agent 已休眠',
          detail: next.workerAwake ? '正在创建新的 DSH 握手会话；收到“我已链接”后才会标记在线。' : '执行端不会接收新任务。',
          state: next.workerAwake ? 'waiting' : 'info',
          metadata: { channel: 'worker', visibility: 'both' },
        });
      }
      response.json(next);
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : 'invalid_control_state' });
    }
  });

  // Temporary UI draft endpoint kept for local development / proof-worker testing.
  app.post('/ui-api/drafts', express.json({ limit: '64kb' }), (request, response) => {
    const controlState = options.controlState.get();
    if (!controlState.roomEnabled) {
      response.status(409).json({ error: 'room_disabled' });
      return;
    }
    if (!controlState.workerAwake) {
      response.status(409).json({ error: 'worker_asleep' });
      return;
    }
    const provider = modelProviders.find((item) => item.id === request.body?.providerId);
    const objective = text(request.body?.objective);
    if (!provider || !objective) {
      response.status(400).json({ error: 'invalid_draft' });
      return;
    }

    const event = options.timeline?.add({
      type: 'task.draft.created',
      kind: 'message',
      actor: 'chatgpt-controller',
      title: 'ChatGPT → 执行 Agent',
      detail: objective,
      state: 'waiting',
      metadata: {
        channel: 'controller',
        visibility: 'both',
        providerId: provider.id,
        providerName: provider.name,
        modelId: request.body?.modelId ?? null,
        tier: request.body?.tier ?? null,
        reasoningEffort: request.body?.reasoningEffort ?? null,
        role: request.body?.role ?? 'worker',
        permission: request.body?.permission ?? 'read-only',
        delivery: 'development-draft-only',
      },
    });
    options.timeline?.add({
      type: 'worker.waiting',
      kind: 'status',
      actor: 'worker',
      title: '执行端等待真实适配器',
      detail: `${provider.name} 的真实客户端适配器尚未接通。`,
      state: 'waiting',
      metadata: {
        channel: 'worker',
        visibility: 'agent',
        providerId: provider.id,
        providerName: provider.name,
        modelId: request.body?.modelId ?? null,
        reasoningEffort: request.body?.reasoningEffort ?? null,
        permission: request.body?.permission ?? 'read-only',
      },
    });
    response.status(201).json({ draft: event, externalModelCalled: false });
  });

  app.post('/ui-api/interventions', express.json({ limit: '32kb' }), (request, response) => {
    const control = options.controlState.get();
    if (!control.roomEnabled || !control.workerAwake) {
      response.status(409).json({ error: 'worker_not_awake' });
      return;
    }
    const message = text(request.body?.message, 12_000);
    if (!message) {
      response.status(400).json({ error: 'message_required' });
      return;
    }
    const taskId = text(request.body?.taskId, 120) || null;
    if (taskId && !taskStore.get(taskId)) {
      response.status(404).json({ error: 'task_not_found' });
      return;
    }
    const event = options.timeline?.add({
      type: 'human.intervention',
      kind: 'message',
      actor: 'human-owner',
      title: '用户直接对执行 Agent 说',
      detail: message,
      state: 'info',
      metadata: {
        channel: 'human',
        visibility: 'both',
        target: 'worker',
        delivery: 'shared-timeline',
        source: 'agent-window',
        ...(taskId ? { taskId } : {}),
      },
    });
    const demoResumed = taskId ? demoRunner?.respond(taskId, message) ?? false : false;
    if (taskId && !demoResumed) {
      const task = taskStore.get(taskId);
      if (task?.status === 'waiting-user') taskStore.update(taskId, { status: 'running', waitingReason: null, lastSummary: `用户回复：${message.slice(0, 160)}` });
    }
    response.status(201).json({
      event,
      task: taskId ? taskStore.get(taskId) : null,
      demoResumed,
      delivery: 'shared-timeline',
      externalModelCalled: false,
      note: '真实执行端接入后应从共享时间线读取此消息。',
    });
  });

  // ---- ChatGPT client bridge -------------------------------------------------
  app.get('/client-api/session', bearerGuard(options.controllerToken), (_request, response) => {
    response.json(options.controllerSession.get());
  });
  app.post('/client-api/session', bearerGuard(options.controllerToken), express.json({ limit: '16kb' }), (request, response) => {
    const before = options.controllerSession.get();
    const patch: ControllerSessionUpdate = {
      clientName: text(request.body?.clientName, 80) || 'ChatGPT',
    };
    if (request.body?.model === null) patch.model = null;
    else { const model = text(request.body?.model, 160); if (model) patch.model = model; }
    if (request.body?.conversationId === null) patch.conversationId = null;
    else { const conversationId = text(request.body?.conversationId, 200); if (conversationId) patch.conversationId = conversationId; }
    if (['idle', 'busy', 'waiting'].includes(request.body?.state)) patch.state = request.body.state;
    const next = options.controllerSession.update(patch);
    if (!before.connected) {
      options.timeline?.add({
        type: 'controller.connected',
        kind: 'status',
        actor: 'chatgpt-controller',
        title: 'ChatGPT 主控已连接',
        detail: next.model ? `当前模型：${next.model}` : '主控客户端已注册到任务室。',
        state: 'success',
        metadata: { channel: 'system', visibility: 'both' },
      });
    }
    response.json(next);
  });
  app.post('/client-api/heartbeat', bearerGuard(options.controllerToken), (_request, response) => {
    response.json(options.controllerSession.heartbeat());
  });
  app.delete('/client-api/session', bearerGuard(options.controllerToken), (_request, response) => {
    const next = options.controllerSession.disconnect();
    options.timeline?.add({
      type: 'controller.disconnected',
      kind: 'status',
      actor: 'chatgpt-controller',
      title: 'ChatGPT 主控已断开',
      detail: '等待 ChatGPT 客户端重新连接。',
      state: 'info',
      metadata: { channel: 'system', visibility: 'both' },
    });
    response.json(next);
  });
  app.get('/client-api/timeline', bearerGuard(options.controllerToken), (request, response) => {
    const after = typeof request.query.after === 'string' ? request.query.after : null;
    response.json({ events: options.timeline?.listAfter(after) ?? [] });
  });
  app.post('/client-api/tasks', bearerGuard(options.controllerToken), express.json({ limit: '64kb' }), (request, response) => {
    if (!dispatchReady()) {
      response.status(409).json({ error: 'worker_not_awake' });
      return;
    }
    const objective = text(request.body?.objective);
    if (!objective) {
      response.status(400).json({ error: 'objective_required' });
      return;
    }
    const config = options.executionConfig.get();
    const taskTitle = text(request.body?.title, 180);
    const task = taskStore.create({
      ...(taskTitle ? { title: taskTitle } : {}),
      objective, source: 'chatgpt', status: 'queued',
      providerId: config.providerId, modelId: config.modelId, reasoningEffort: config.reasoningEffort,
      role: config.role, permission: config.permission, workspaceRoot: config.workspaceRoot,
    });
    options.timeline?.add({
      type: 'controller.task.created', kind: 'message', actor: 'chatgpt-controller', title: text(request.body?.title, 240) || 'ChatGPT → 执行 Agent',
      detail: objective, state: 'info', metadata: {
        channel: 'controller', visibility: 'both', taskId: task.id,
        providerId: task.providerId, modelId: task.modelId, reasoningEffort: task.reasoningEffort,
        role: task.role, permission: task.permission, workspaceRoot: task.workspaceRoot,
      },
    });
    response.status(201).json({ task });
  });

  app.post('/client-api/events', bearerGuard(options.controllerToken), express.json({ limit: '64kb' }), (request, response) => {
    if (!dispatchReady()) {
      response.status(409).json({ error: 'worker_not_awake' });
      return;
    }
    const kind = timelineKinds.has(request.body?.kind) ? request.body.kind as TimelineKind : 'message';
    const detail = text(request.body?.detail);
    if (!detail) {
      response.status(400).json({ error: 'detail_required' });
      return;
    }
    options.controllerSession.heartbeat();
    const incomingMetadata = request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {};
    const taskId = text((incomingMetadata as Record<string, unknown>).taskId, 120) || null;
    if (taskId && !taskStore.get(taskId)) {
      response.status(404).json({ error: 'task_not_found' });
      return;
    }
    const event = options.timeline?.add({
      type: text(request.body?.type, 120) || `controller.${kind}`,
      kind,
      actor: 'chatgpt-controller',
      title: text(request.body?.title, 240) || (kind === 'message' ? 'ChatGPT → 执行 Agent' : 'ChatGPT 状态'),
      detail,
      state: timelineState(kind, request.body?.state),
      metadata: {
        ...incomingMetadata,
        channel: 'controller',
        visibility: kind === 'status' ? 'both' : 'room',
      },
    });
    if (taskId) {
      const nextStatus = statusForEvent(kind, request.body?.state);
      taskStore.applyEventStatus(taskId, nextStatus, detail, 'controller');
    }
    response.status(201).json({ event, task: taskId ? taskStore.get(taskId) : null });
  });

  // ---- Worker bridge (DSH adapter plugs in here later) -----------------------
  app.get('/worker-api/session', bearerGuard(options.controllerToken), (_request, response) => {
    response.json(options.workerSession.get());
  });
  app.post('/worker-api/session', bearerGuard(options.controllerToken), express.json({ limit: '16kb' }), (request, response) => {
    const before = options.workerSession.get();
    const patch: WorkerSessionUpdate = { clientName: text(request.body?.clientName, 80) || 'DeepSeek Harness' };
    if (request.body?.model === null) patch.model = null;
    else { const model = text(request.body?.model, 160); if (model) patch.model = model; }
    if (request.body?.sessionId === null) patch.sessionId = null;
    else { const sessionId = text(request.body?.sessionId, 200); if (sessionId) patch.sessionId = sessionId; }
    if (['idle', 'busy', 'waiting', 'paused'].includes(request.body?.state)) patch.state = request.body.state;
    const next = options.workerSession.update(patch);
    if (!before.connected) options.timeline?.add({ type: 'worker.connected', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek 执行端已连接', detail: next.model ? `当前模型：${next.model}` : 'DSH 已连接到本地中转站。', state: 'success', metadata: { channel: 'system', visibility: 'both' } });
    response.json(next);
  });
  app.post('/worker-api/heartbeat', bearerGuard(options.controllerToken), (_request, response) => {
    response.json(options.workerSession.heartbeat());
  });
  app.delete('/worker-api/session', bearerGuard(options.controllerToken), (_request, response) => {
    const next = options.workerSession.disconnect();
    options.timeline?.add({ type: 'worker.disconnected', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek 执行端已断开', detail: '等待 DSH 重新连接。', state: 'info', metadata: { channel: 'system', visibility: 'both' } });
    response.json(next);
  });
  app.get('/worker-api/config', bearerGuard(options.controllerToken), (_request, response) => {
    response.json(options.executionConfig.get());
  });
  app.get('/worker-api/tasks/:taskId', bearerGuard(options.controllerToken), (request, response) => {
    const taskId = text(request.params.taskId, 120);
    const task = taskId ? taskStore.get(taskId) : null;
    if (!task) {
      response.status(404).json({ error: 'task_not_found' });
      return;
    }
    response.json(task);
  });
  app.get('/worker-api/timeline', bearerGuard(options.controllerToken), (request, response) => {
    const after = typeof request.query.after === 'string' ? request.query.after : null;
    response.json({ events: options.timeline?.listAfter(after) ?? [] });
  });
  app.post('/worker-api/events', bearerGuard(options.controllerToken), express.json({ limit: '64kb' }), (request, response) => {
    const kind = timelineKinds.has(request.body?.kind) ? request.body.kind as TimelineKind : 'status';
    const detail = text(request.body?.detail);
    if (!detail) {
      response.status(400).json({ error: 'detail_required' });
      return;
    }
    const incomingMetadata = request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {};
    options.workerSession.heartbeat();
    const taskId = text((incomingMetadata as Record<string, unknown>).taskId, 120) || null;
    if (taskId && !taskStore.get(taskId)) {
      response.status(404).json({ error: 'task_not_found' });
      return;
    }
    const event = options.timeline?.add({
      type: text(request.body?.type, 120) || `worker.${kind}`,
      kind,
      actor: text(request.body?.actor, 80) || 'deepseek-worker',
      title: text(request.body?.title, 240) || ({
        reasoning: 'DeepSeek · 思考',
        tool: 'DeepSeek · 工具',
        result: 'DeepSeek · 结果',
        question: 'DeepSeek · 提问',
        permission_request: 'DeepSeek · 权限申请',
        message: 'DeepSeek → ChatGPT',
        status: 'DeepSeek · 状态',
      } as Record<TimelineKind, string>)[kind],
      detail,
      state: timelineState(kind, request.body?.state),
      metadata: {
        ...incomingMetadata,
        channel: 'worker',
        visibility: kind === 'message' || kind === 'result' || kind === 'question' || kind === 'permission_request' ? 'both' : 'agent',
        contentSource: 'worker-provided',
      },
    });
    if (taskId) {
      const nextStatus = statusForEvent(kind, request.body?.state);
      taskStore.applyEventStatus(taskId, nextStatus, detail, 'worker');
    }
    response.status(201).json({ event, task: taskId ? taskStore.get(taskId) : null });
  });

  app.get('/docs', (_request, response) => {
    response.sendFile(resolve('docs', 'architecture.zh-CN.md'));
  });
  app.get('/handoff', (_request, response) => {
    response.sendFile(resolve('docs', 'HANDOFF.zh-CN.md'));
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    '/a2a',
    bearerGuard(options.controllerToken),
    (_request, response, next) => {
      const controlState = options.controlState.get();
      if (!controlState.roomEnabled || !controlState.workerAwake) {
        response.status(409).json({ error: 'worker_not_awake' });
        return;
      }
      next();
    },
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return app;
}
