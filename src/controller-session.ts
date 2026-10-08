export type ControllerSessionState = 'idle' | 'busy' | 'waiting' | 'offline';

export interface ControllerSessionSnapshot {
  connected: boolean;
  clientName: string;
  model: string | null;
  conversationId: string | null;
  state: ControllerSessionState;
  lastSeenAt: string | null;
}

export interface ControllerSessionUpdate {
  clientName?: string;
  model?: string | null;
  conversationId?: string | null;
  state?: Exclude<ControllerSessionState, 'offline'>;
}

export class ControllerSessionStore {
  private clientName = 'ChatGPT';
  private model: string | null = null;
  private conversationId: string | null = null;
  private state: Exclude<ControllerSessionState, 'offline'> = 'idle';
  private lastSeenAt: string | null = null;

  constructor(private readonly staleAfterMs = 45_000) {}

  get(): ControllerSessionSnapshot {
    const connected = this.lastSeenAt !== null
      && Date.now() - new Date(this.lastSeenAt).getTime() <= this.staleAfterMs;
    return {
      connected,
      clientName: this.clientName,
      model: this.model,
      conversationId: this.conversationId,
      state: connected ? this.state : 'offline',
      lastSeenAt: this.lastSeenAt,
    };
  }

  update(patch: ControllerSessionUpdate): ControllerSessionSnapshot {
    if (typeof patch.clientName === 'string' && patch.clientName.trim()) {
      this.clientName = patch.clientName.trim().slice(0, 80);
    }
    if (patch.model === null || typeof patch.model === 'string') {
      this.model = patch.model?.trim().slice(0, 160) || null;
    }
    if (patch.conversationId === null || typeof patch.conversationId === 'string') {
      this.conversationId = patch.conversationId?.trim().slice(0, 200) || null;
    }
    if (patch.state && ['idle', 'busy', 'waiting'].includes(patch.state)) {
      this.state = patch.state;
    }
    this.lastSeenAt = new Date().toISOString();
    return this.get();
  }

  heartbeat(): ControllerSessionSnapshot {
    this.lastSeenAt = new Date().toISOString();
    return this.get();
  }

  disconnect(): ControllerSessionSnapshot {
    this.lastSeenAt = null;
    this.state = 'idle';
    return this.get();
  }
}
