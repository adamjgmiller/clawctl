import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureClawctlDir } from '../config/index.js';
import { AuditEntrySchema } from './types.js';
import type { AuditEntry, AuditQuery } from './types.js';
import type { AuditStore } from './store.js';

const AUDIT_FILE = 'audit.json';

export class JsonAuditStore implements AuditStore {
  private filePath: string | undefined;

  private async getFilePath(): Promise<string> {
    if (!this.filePath) {
      const dir = await ensureClawctlDir();
      this.filePath = join(dir, AUDIT_FILE);
    }
    return this.filePath;
  }

  private async readAll(): Promise<AuditEntry[]> {
    const path = await this.getFilePath();
    if (!existsSync(path)) return [];
    const raw = await readFile(path, 'utf-8');
    const data = JSON.parse(raw) as unknown[];
    return data.map((item) => AuditEntrySchema.parse(item));
  }

  private async writeAll(entries: AuditEntry[]): Promise<void> {
    const path = await this.getFilePath();
    await writeFile(path, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
  }

  async append(entry: AuditEntry): Promise<void> {
    const entries = await this.readAll();
    entries.push(entry);
    await this.writeAll(entries);
  }

  async query(query: AuditQuery): Promise<AuditEntry[]> {
    let entries = await this.readAll();

    if (query.action) {
      entries = entries.filter((e) => e.action === query.action);
    }
    if (query.agentId) {
      entries = entries.filter((e) => e.agentId === query.agentId);
    }
    if (query.since) {
      entries = entries.filter((e) => e.timestamp >= query.since!);
    }

    // Most recent first
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return entries.slice(0, query.limit);
  }

  async get(id: string): Promise<AuditEntry | undefined> {
    const entries = await this.readAll();
    return entries.find((e) => e.id === id);
  }
}
