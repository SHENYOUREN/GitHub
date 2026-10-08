import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry, AuditSink } from './types.js';

export class JsonLineAuditSink implements AuditSink {
  constructor(private readonly path: string) {}

  async write(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];

  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}
