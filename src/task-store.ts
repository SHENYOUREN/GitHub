import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionRole, WorkspacePermission } from './execution-config.js';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'waiting-user' | 'completed' | 'failed' | 'cancelled';
export type TaskSource = 'chatgpt' | 'demo' | 'manual';
export type TaskEventSource = 'controller' | 'worker';

export interface TaskRecord {
  id: string;
  title: string;
  objective: string;
  source: TaskSource;
  status: TaskStatus;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  role: ExecutionRole;
  permission: WorkspacePermission;
  workspaceRoot: string | null;
  createdAt: string;
  updatedAt: string;
  waitingReason: string | null;
  lastSummary: string | null;
}

export interface TaskCreateInput {
  title?: string;
  objective: string;
  source: TaskSource;
  status?: TaskStatus;
  providerId?: string | null;
  modelId?: string | null;
  reasoningEffort?: string | null;
  role?: ExecutionRole;
  permission?: WorkspacePermission;
  workspaceRoot?: string | null;
}

const terminalStatuses = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

export class TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(private readonly filePath?: string) {
    this.load();
  }

  private normalize(task: Partial<TaskRecord>): TaskRecord | null {
    if (!task.id || !task.objective || !task.createdAt || !task.updatedAt) return null;
    return {
      id: task.id,
      title: task.title?.trim().slice(0, 180) || task.objective.trim().slice(0, 80) || '未命名任务',
      objective: task.objective.trim().slice(0, 20_000),
      source: ['chatgpt', 'demo', 'manual'].includes(task.source ?? '') ? task.source as TaskSource : 'manual',
      status: ['queued', 'running', 'paused', 'waiting-user', 'completed', 'failed', 'cancelled'].includes(task.status ?? '') ? task.status as TaskStatus : 'failed',
      providerId: task.providerId ?? null,
      modelId: task.modelId ?? null,
      reasoningEffort: task.reasoningEffort ?? null,
      role: ['worker', 'reviewer', 'researcher'].includes(task.role ?? '') ? task.role as ExecutionRole : 'worker',
      permission: ['read-only', 'workspace-write'].includes(task.permission ?? '') ? task.permission as WorkspacePermission : 'read-only',
      workspaceRoot: task.workspaceRoot ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      waitingReason: task.waitingReason ?? null,
      lastSummary: task.lastSummary ?? null,
    };
  }

  private load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<TaskRecord>[];
      if (!Array.isArray(parsed)) return;
      for (const raw of parsed) {
        const task = this.normalize(raw);
        if (task) this.tasks.set(task.id, task);
      }
    } catch {
      // Corrupted history should not prevent the local control room from starting.
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.list(), null, 2), 'utf8');
    renameSync(temp, this.filePath);
  }

  create(input: TaskCreateInput): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      title: input.title?.trim().slice(0, 180) || input.objective.trim().slice(0, 80) || '未命名任务',
      objective: input.objective.trim().slice(0, 20_000),
      source: input.source,
      status: input.status ?? 'queued',
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      role: input.role ?? 'worker',
      permission: input.permission ?? 'read-only',
      workspaceRoot: input.workspaceRoot ?? null,
      createdAt: now,
      updatedAt: now,
      waitingReason: null,
      lastSummary: null,
    };
    this.tasks.set(task.id, task);
    this.persist();
    return { ...task };
  }

  get(taskId: string): TaskRecord | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((task) => ({ ...task }));
  }

  update(taskId: string, patch: Partial<Pick<TaskRecord, 'title' | 'status' | 'waitingReason' | 'lastSummary' | 'providerId' | 'modelId' | 'reasoningEffort' | 'workspaceRoot'>>): TaskRecord | null {
    const current = this.tasks.get(taskId);
    if (!current) return null;
    const next: TaskRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, next);
    this.persist();
    return { ...next };
  }

  applyEventStatus(taskId: string, nextStatus: TaskStatus | null, detail: string, source: TaskEventSource): TaskRecord | null {
    const current = this.tasks.get(taskId);
    if (!current || !nextStatus) return current ? { ...current } : null;

    if (terminalStatuses.has(current.status)) return { ...current };
    if (terminalStatuses.has(nextStatus)) {
      return this.update(taskId, { status: nextStatus, waitingReason: null, lastSummary: detail.slice(0, 500) });
    }
    if (current.status === 'paused') return { ...current };
    if (current.status === 'waiting-user' && nextStatus === 'running' && source === 'worker') return { ...current };

    return this.update(taskId, {
      status: nextStatus,
      waitingReason: nextStatus === 'waiting-user' ? detail : null,
      lastSummary: detail.slice(0, 500),
    });
  }

  failInterruptedOnStartup(): TaskRecord[] {
    const interrupted: TaskRecord[] = [];
    for (const task of this.tasks.values()) {
      if (!['running', 'paused', 'waiting-user'].includes(task.status)) continue;
      const next: TaskRecord = {
        ...task,
        status: 'failed',
        waitingReason: null,
        lastSummary: '中转站曾在任务未结束时停止；当前版本不会自动恢复真实执行会话，请重新派发或人工确认后继续。',
        updatedAt: new Date().toISOString(),
      };
      this.tasks.set(task.id, next);
      interrupted.push({ ...next });
    }
    if (interrupted.length) this.persist();
    return interrupted;
  }
}
