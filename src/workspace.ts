export const DEFAULT_DEEPSEEK_WORKSPACE = 'D:\\GPT工作室\\执行端文件夹\\deepseek执行端';

export const LEGACY_DEEPSEEK_WORKSPACES = new Set([
  'D:\\AI工作区',
  'D:\\GPT工作室',
]);

export function normalizeExecutionWorkspace(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_DEEPSEEK_WORKSPACE;
  const trimmed = value.trim();
  return LEGACY_DEEPSEEK_WORKSPACES.has(trimmed) ? DEFAULT_DEEPSEEK_WORKSPACE : trimmed;
}
