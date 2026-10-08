export type WorkerSessionState = 'idle' | 'busy' | 'waiting' | 'paused' | 'offline';

export interface WorkerSessionSnapshot {
  connected: boolean;
  clientName: string;
  model: string | null;
  sessionId: string | null;
  state: WorkerSessionState;
  lastSeenAt: string | null;
}

export interface WorkerSessionUpdate {
  clientName?: string;
  model?: string | null;
  sessionId?: string | null;
  state?: Exclude<WorkerSessionState, 'offline'>;
}

export class WorkerSessionStore {
  private clientName = 'DeepSeek Harness';
  private model: string | null = null;
  private sessionId: string | null = null;
  private state: Exclude<WorkerSessionState, 'offline'> = 'idle';
  private lastSeenAt: string | null = null;

  constructor(private readonly staleAfterMs = 45_000) {}

  get(): WorkerSessionSnapshot {
    const connected = this.lastSeenAt !== null
      && Date.now() - new Date(this.lastSeenAt).getTime() <= this.staleAfterMs;
    return {
      connected,
      clientName: this.clientName,
      model: this.model,
      sessionId: this.sessionId,
      state: connected ? this.state : 'offline',
      lastSeenAt: this.lastSeenAt,
    };
  }

  update(patch: WorkerSessionUpdate): WorkerSessionSnapshot {
    if (typeof patch.clientName === 'string' && patch.clientName.trim()) this.clientName = patch.clientName.trim().slice(0, 80);
    if (patch.model === null || typeof patch.model === 'string') this.model = patch.model?.trim().slice(0, 160) || null;
    if (patch.sessionId === null || typeof patch.sessionId === 'string') this.sessionId = patch.sessionId?.trim().slice(0, 200) || null;
    if (patch.state && ['idle', 'busy', 'waiting', 'paused'].includes(patch.state)) this.state = patch.state;
    this.lastSeenAt = new Date().toISOString();
    return this.get();
  }

  heartbeat(): WorkerSessionSnapshot {
    this.lastSeenAt = new Date().toISOString();
    return this.get();
  }

  disconnect(): WorkerSessionSnapshot {
    this.lastSeenAt = null;
    this.state = 'idle';
    return this.get();
  }
}
