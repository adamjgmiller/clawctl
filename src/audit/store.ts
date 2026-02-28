import type { AuditEntry, AuditQuery } from './types.js';

/**
 * Append-only audit log store interface.
 * Implementations: JsonAuditStore (local), DynamoAuditStore (AWS).
 */
export interface AuditStore {
  /** Append a new audit entry. */
  append(entry: AuditEntry): Promise<void>;

  /** Query audit entries with optional filters. */
  query(query: AuditQuery): Promise<AuditEntry[]>;

  /** Get a single entry by ID. */
  get(id: string): Promise<AuditEntry | undefined>;
}
