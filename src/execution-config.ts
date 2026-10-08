import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ExecutionRole = 'worker' | 'reviewer' | 'researcher';
export type WorkspacePermission = 'read-only' | 'workspace-write';

export interface ExecutionConfig {
  providerId: string;
  modelId: string | null;
  reasoningEffort: string | null;
  role: ExecutionRole;
  permission: WorkspacePermission;
  workspaceRoot: string;
  updatedAt: string | null;
}

const defaultConfig: ExecutionConfig = {
  providerId: 'deepseek-harness',
  modelId: 'dsh-current',
  reasoningEffort: 'high',
  role: 'worker',
  permission: 'read-only',
  workspaceRoot: 'D:\\GPT工作室',
  updatedAt: null,
};

export class ExecutionConfigStore {
  private state: ExecutionConfig = { ...defaultConfig };

  constructor(private readonly filePath?: string) {
    this.load();
  }

  private load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ExecutionConfig>;
      if (!parsed || typeof parsed !== 'object') return;
      this.state = {
        providerId: typeof parsed.providerId === 'string' && parsed.providerId ? parsed.providerId : defaultConfig.providerId,
        modelId: parsed.modelId === null || typeof parsed.modelId === 'string' ? parsed.modelId : defaultConfig.modelId,
        reasoningEffort: parsed.reasoningEffort === null || typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : defaultConfig.reasoningEffort,
        role: ['worker', 'reviewer', 'researcher'].includes(parsed.role ?? '') ? parsed.role as ExecutionRole : defaultConfig.role,
        permission: ['read-only', 'workspace-write'].includes(parsed.permission ?? '') ? parsed.permission as WorkspacePermission : defaultConfig.permission,
        workspaceRoot: typeof parsed.workspaceRoot === 'string' && parsed.workspaceRoot.trim() ? parsed.workspaceRoot : defaultConfig.workspaceRoot,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    } catch {
      // A damaged local config should fall back to safe defaults instead of blocking startup.
      this.state = { ...defaultConfig };
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(temp, this.filePath);
  }

  get(): ExecutionConfig {
    return { ...this.state };
  }

  update(patch: Partial<Omit<ExecutionConfig, 'updatedAt'>>): ExecutionConfig {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.get();
  }
}
