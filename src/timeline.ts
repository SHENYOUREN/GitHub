import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry, AuditSink, TimelineEvent } from './types.js';

export type TimelineListener = (event: TimelineEvent) => void;

export class TimelineStore implements AuditSink {
  private readonly events: TimelineEvent[] = [];
  private readonly listeners = new Set<TimelineListener>();

  constructor(private readonly limit = 500, private readonly filePath?: string) {
    this.load();
  }

  private load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as TimelineEvent[];
      if (Array.isArray(parsed)) this.events.push(...parsed.slice(-this.limit));
    } catch {
      // Keep the local relay available even if an old history file is damaged.
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.events, null, 2), 'utf8');
    renameSync(temp, this.filePath);
  }

  add(event: Omit<TimelineEvent, 'id' | 'timestamp'> & { timestamp?: string }): TimelineEvent {
    const stored: TimelineEvent = {
      ...event,
      id: randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.events.push(stored);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    this.persist();
    for (const listener of this.listeners) listener(stored);
    return stored;
  }

  list(): TimelineEvent[] {
    return [...this.events];
  }

  listAfter(eventId?: string | null): TimelineEvent[] {
    if (!eventId) return this.list();
    const index = this.events.findIndex((event) => event.id === eventId);
    return index < 0 ? this.list() : this.events.slice(index + 1);
  }

  remove(eventId: string): boolean {
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index < 0) return false;
    this.events.splice(index, 1);
    this.persist();
    return true;
  }

  clear(): number {
    const removed = this.events.length;
    this.events.splice(0, this.events.length);
    this.persist();
    return removed;
  }

  subscribe(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async write(entry: AuditEntry): Promise<void> {
    const isFailure = entry.event.includes('failed') || entry.event.includes('cancelled');
    const isComplete = entry.event.includes('completed');
    const detail = typeof entry.detail?.message === 'string' ? entry.detail.message : undefined;
    this.add({
      timestamp: entry.timestamp,
      type: entry.event,
      kind: isFailure || isComplete ? 'result' : 'status',
      actor: entry.actorId ?? entry.targetId ?? 'system',
      title: entry.event,
      state: isFailure ? 'error' : isComplete ? 'success' : 'info',
      ...(detail ? { detail } : {}),
      ...(entry.detail ? { metadata: entry.detail } : {}),
    });
  }
}

export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}

  async write(entry: AuditEntry): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.write(entry)));
  }
}
