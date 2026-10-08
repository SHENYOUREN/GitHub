export const HIERARCHY_METADATA_KEY = 'io.github.shenyouren.hierarchy';

export type PrincipalRole = 'human-owner' | 'controller' | 'worker' | 'reviewer';
export type WorkerMessageType =
  | 'status'
  | 'result'
  | 'question'
  | 'permission_request'
  | 'failure';

export interface Principal {
  id: string;
  role: PrincipalRole;
  client?: string;
}

export interface TaskEnvelope {
  protocolVersion: '0.1';
  taskId: string;
  parentTaskId?: string | null;
  issuedBy: Principal;
  assignedTo: Principal;
  objective: string;
  authority: {
    controllerId: string;
    workerRole: 'worker' | 'reviewer';
    allowedWorkerMessages: WorkerMessageType[];
  };
  permissions: {
    workspaceMode: 'read-only' | 'workspace-write';
    allowedRoots?: string[];
    network: 'none' | 'allowlist' | 'unrestricted';
    networkAllowlist?: string[];
    destructiveActions: 'require-human-approval';
  };
  acceptanceCriteria: string[];
  createdAt: string;
  expiresAt?: string | null;
  idempotencyKey?: string;
}

export interface WorkerRequest {
  taskId: string;
  contextId: string;
  objective: string;
  envelope: TaskEnvelope;
  signal: AbortSignal;
}

export interface WorkerResult {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerAdapter {
  readonly id: string;
  readonly kind: string;
  readonly capabilities: readonly string[];
  run(request: WorkerRequest): Promise<WorkerResult>;
}

export interface AuditEntry {
  timestamp: string;
  event: string;
  taskId?: string;
  actorId?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

export interface AuditSink {
  write(entry: AuditEntry): Promise<void>;
}
