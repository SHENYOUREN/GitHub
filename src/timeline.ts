import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditSink, TimelineEvent } from './types.js';

export class TimelineStore implements AuditSink {
  private readonly events: TimelineEvent[] = [];
  private readonly limit: number;

  constructor(limit = 500) {
    this.limit = limit;
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
    return stored;
  }

  list(): TimelineEvent[] {
    return [...this.events];
  }

  async write(entry: AuditEntry): Promise<void> {
    const isFailure = entry.event.includes('failed') || entry.event.includes('cancelled');
    const isComplete = entry.event.includes('completed');
    const detail = typeof entry.detail?.message === 'string'
      ? entry.detail.message
      : undefined;
    this.add({
      timestamp: entry.timestamp,
      type: entry.event,
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
