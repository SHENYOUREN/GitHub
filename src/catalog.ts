import type { ModelProvider } from './types.js';

export const modelProviders: ModelProvider[] = [
  {
    id: 'local-proof',
    name: '本地证明执行器',
    status: 'ready',
    models: [
      {
        id: 'proof-worker',
        name: 'Proof Worker',
        tiers: ['本地'],
        precisionModes: ['快速', '均衡', '严谨'],
        reasoningEfforts: ['off'],
        capabilities: ['文本', '结构化结果', '权限验证'],
      },
    ],
  },
  {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    status: 'bridge-only',
    models: [],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    status: 'not-connected',
    models: [],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    status: 'not-connected',
    models: [],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    status: 'not-connected',
    models: [],
  },
];
