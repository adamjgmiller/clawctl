import { randomUUID } from 'node:crypto';
import { JsonAuditStore } from './json-store.js';
import type { AuditStore } from './store.js';
import type { AuditAction, AuditEntry } from './types.js';

let _store: AuditStore | undefined;

export function getAuditStore(): AuditStore {
  if (!_store) {
    _store = new JsonAuditStore();
  }
  return _store;
}

export function setAuditStore(store: AuditStore): void {
  _store = store;
}

/**
 * Log an audit event. Fire-and-forget — never throws.
 */
export async function audit(
  action: AuditAction,
  opts: {
    agentId?: string;
    agentName?: string;
    detail?: Record<string, unknown>;
    success?: boolean;
    error?: string;
    actor?: string;
  } = {},
): Promise<void> {
  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    actor: opts.actor ?? 'cli',
    agentId: opts.agentId,
    agentName: opts.agentName,
    detail: opts.detail,
    success: opts.success ?? true,
    error: opts.error,
  };

  try {
    await getAuditStore().append(entry);
  } catch {
    // Audit logging should never break the main flow
  }
}
