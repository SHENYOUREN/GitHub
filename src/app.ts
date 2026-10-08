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
import type { TimelineStore } from './timeline.js';
import type { AuditSink, WorkerAdapter } from './types.js';

export interface AppOptions {
  baseUrl: string;
  controllerToken: string;
  worker: WorkerAdapter;
  audit: AuditSink;
  timeline?: TimelineStore;
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
    version: '0.1.0',
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
    securityRequirements: [
      { schemes: { controllerBearer: { list: [] } } },
    ],
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
        securityRequirements: [
          { schemes: { controllerBearer: { list: [] } } },
        ],
      },
    ],
    documentationUrl: `${options.baseUrl}/docs`,
    signatures: [],
  };

  const executor = new HierarchicalExecutor(options.worker, options.audit);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    executor,
  );
  const app = express();

  app.disable('x-powered-by');
  app.use('/assets/icons', express.static(resolve('node_modules', 'lucide-static', 'icons')));
  app.use(express.static(resolve('public')));

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      protocol: A2A_PROTOCOL_VERSION,
      worker: {
        id: options.worker.id,
        kind: options.worker.kind,
        capabilities: options.worker.capabilities,
      },
    });
  });
  app.get('/api/agents', bearerGuard(options.controllerToken), (_request, response) => {
    response.json({
      controller: { id: 'codex-controller', role: 'controller' },
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
  app.get('/ui-api/catalog', (_request, response) => {
    response.json({ providers: modelProviders });
  });
  app.get('/ui-api/timeline', (_request, response) => {
    response.json({ events: options.timeline?.list() ?? [] });
  });
  app.post('/ui-api/drafts', express.json({ limit: '64kb' }), (request, response) => {
    const provider = modelProviders.find((item) => item.id === request.body?.providerId);
    const objective = typeof request.body?.objective === 'string'
      ? request.body.objective.trim()
      : '';
    if (!provider || !objective) {
      response.status(400).json({ error: 'invalid_draft' });
      return;
    }

    const event = options.timeline?.add({
      type: 'task.draft.created',
      actor: 'codex-controller',
      title: '主控端下发任务',
      detail: objective,
      state: 'waiting',
      metadata: {
        channel: 'controller',
        providerId: provider.id,
        providerName: provider.name,
        modelId: request.body?.modelId ?? null,
        tier: request.body?.tier ?? null,
        precision: request.body?.precision ?? null,
        reasoningEffort: request.body?.reasoningEffort ?? null,
        role: request.body?.role ?? 'worker',
        permission: request.body?.permission ?? 'read-only',
        reasoningSummary: '主控端已整理任务范围，等待用户授权执行端开始工作。',
        toolSummary: '无工具调用',
      },
    });
    options.timeline?.add({
      type: 'worker.authorization.waiting',
      actor: request.body?.role ?? 'worker',
      title: '执行端等待授权',
      detail: `${provider.name} 尚未开始执行此任务。`,
      state: 'waiting',
      metadata: {
        channel: request.body?.role ?? 'worker',
        providerId: provider.id,
        providerName: provider.name,
        modelId: request.body?.modelId ?? null,
        tier: request.body?.tier ?? null,
        reasoningEffort: request.body?.reasoningEffort ?? null,
        permission: request.body?.permission ?? 'read-only',
        reasoningSummary: '未运行：执行端尚未获得用户授权。',
        toolSummary: '无工具调用，未读取文件，未访问网络。',
      },
    });
    response.status(201).json({
      draft: event,
      requiresExplicitAuthorization: true,
      externalModelCalled: false,
    });
  });
  app.get('/docs', (_request, response) => {
    response.redirect('https://github.com/SHENYOUREN/GitHub/blob/main/docs/architecture.zh-CN.md');
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    '/a2a',
    bearerGuard(options.controllerToken),
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return app;
}
