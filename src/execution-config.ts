import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DEEPSEEK_WORKSPACE, normalizeExecutionWorkspace } from './workspace.js';

export type ExecutionRole = 'worker' | 'reviewer' | 'researcher';
export type WorkspacePermission = 'read-only' | 'workspace-write';

export interface DshSyncedSettings {
  provider: string | null;
  model: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
  source: 'session-last-used' | 'profile-default' | 'fallback';
  sessionId: string | null;
  syncedAt: string;
}

export interface ExecutionConfig {
  providerId: string;
  modelId: string | null;
  reasoningEffort: string | null;
  role: ExecutionRole;
  permission: WorkspacePermission;
  workspaceRoot: string;
  dshSynced: DshSyncedSettings | null;
  updatedAt: string | null;
}

const defaultConfig: ExecutionConfig = {
  providerId: 'deepseek-harness',
  modelId: 'dsh-current',
  reasoningEffort: 'high',
  role: 'worker',
  permission: 'read-only',
  workspaceRoot: DEFAULT_DEEPSEEK_WORKSPACE,
  dshSynced: null,
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
        workspaceRoot: normalizeExecutionWorkspace(parsed.workspaceRoot),
        dshSynced: parsed.dshSynced && typeof parsed.dshSynced === 'object'
          ? {
              provider: typeof parsed.dshSynced.provider === 'string' ? parsed.dshSynced.provider : null,
              model: typeof parsed.dshSynced.model === 'string' ? parsed.dshSynced.model : null,
              modelName: typeof parsed.dshSynced.modelName === 'string' ? parsed.dshSynced.modelName : null,
              reasoningEffort: typeof parsed.dshSynced.reasoningEffort === 'string' ? parsed.dshSynced.reasoningEffort : null,
              source: ['session-last-used', 'profile-default', 'fallback'].includes(parsed.dshSynced.source ?? '')
                ? parsed.dshSynced.source as DshSyncedSettings['source']
                : 'fallback',
              sessionId: typeof parsed.dshSynced.sessionId === 'string' ? parsed.dshSynced.sessionId : null,
              syncedAt: typeof parsed.dshSynced.syncedAt === 'string' ? parsed.dshSynced.syncedAt : new Date(0).toISOString(),
            }
          : null,
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
