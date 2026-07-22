/**
 * Port for the append-only security and lifecycle audit log.
 *
 * One generic log for every category listed in architecture/identity-and-
 * authorization.md, section "17. Security Logging", plus garden lifecycle
 * changes — see `platform.audit_event` in
 * migrations/1784736116655_identity-and-gardens-baseline.sql.
 */

import type { Uuid } from '../../shared/identifiers/uuid.js';

export type AuditActorType = 'user' | 'system' | 'administrator';

export interface AuditEventInput {
  readonly eventType: string;
  readonly subjectType: string;
  readonly subjectId: Uuid;
  readonly actorProfileId: Uuid | null;
  readonly actorType: AuditActorType;
  readonly details?: unknown;
}

export interface AuditLogger {
  /**
   * Records one audit event. Must be called with a transaction-scoped handle
   * bound to the same transaction as the change being audited, so the audit
   * record and the change it describes commit or roll back together.
   */
  record(input: AuditEventInput): Promise<void>;
}
