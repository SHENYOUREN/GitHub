import express, { type RequestHandler } from 'express';
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
import type { AuditSink, WorkerAdapter } from './types.js';

export interface AppOptions {
  baseUrl: string;
  controllerToken: string;
  worker: WorkerAdapter;
  audit: AuditSink;
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
