import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database-gateway.js';
import { generateUuidV7 } from '../../shared/identifiers/uuid.js';
import type { Clock } from '../../shared/time/clock.js';
import type { AuditEventInput, AuditLogger } from './audit-logger.js';

export class KyselyAuditLogger implements AuditLogger {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async record(input: AuditEventInput): Promise<void> {
    await this.db
      .insertInto('platform.audit_event')
      .values({
        id: generateUuidV7(),
        event_type: input.eventType,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        actor_profile_id: input.actorProfileId,
        actor_type: input.actorType,
        details: input.details === undefined ? null : JSON.stringify(input.details),
        occurred_at: this.clock.now(),
      })
      .execute();
  }
}
