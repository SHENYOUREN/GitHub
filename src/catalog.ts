import type { ModelProvider } from './types.js';

export const modelProviders: ModelProvider[] = [
  {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    status: 'bridge-only',
    models: [
      {
        id: 'dsh-current',
        name: '跟随 DSH 当前选择',
        tiers: ['默认'],
        precisionModes: ['默认'],
        reasoningEfforts: ['off', 'low', 'medium', 'high'],
        capabilities: ['文本', '执行轨迹', '工具调用', '推理流（若 DSH 提供）'],
      },
      {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash（DSH 默认）',
        tiers: ['官方'],
        precisionModes: ['默认'],
        reasoningEfforts: ['off', 'low', 'high', 'max'],
        capabilities: ['文本', '执行轨迹', '工具调用', '推理流（若 DSH 提供）'],
      },
    ],
  },
  {
    id: 'local-proof',
    name: '本地证明执行器（开发测试）',
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
  { id: 'openai', name: 'OpenAI（预留）', status: 'not-connected', models: [] },
  { id: 'anthropic', name: 'Anthropic（预留）', status: 'not-connected', models: [] },
  { id: 'google', name: 'Google Gemini（预留）', status: 'not-connected', models: [] },
];
