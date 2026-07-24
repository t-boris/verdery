/**
 * The relay's own minimal Kysely schema — exactly the two tables and exactly
 * the columns `verdery_worker` (migrations/1785200000000_media-processing-
 * jobs.sql, in `@verdery/api`) is granted access to: `platform.outbox_event`
 * (read + mark published) and `media.processing_job` (read + create +
 * advance to `queued`).
 *
 * Deliberately NOT imported from `@verdery/api`: this package has its own
 * composition root, service identity, and deployment, and does not import
 * the running API application — architecture/backend-modular-monolith.md
 * section "19. Worker Boundary". Duplicating this narrow slice of column
 * shape here (rather than sharing `services/api/src/platform/database/
 * database-gateway.ts`'s own `DatabaseSchema`) is the deliberate cost of
 * keeping that boundary real: this file's own row shapes must be kept in
 * sync with the migration by hand, the same way `services/api`'s own
 * `persistence/schema.ts` files already are.
 *
 * Source: migrations/1784736116655_identity-and-gardens-baseline.sql
 * (`platform.outbox_event`); migrations/1785200000000_media-processing-
 * jobs.sql (`media.processing_job`).
 */

import type { Generated } from 'kysely';

export interface OutboxEventRow {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  trace_id: string | null;
  occurred_at: Date;
  published_at: Date | null;
  publish_attempts: Generated<number>;
}

export interface ProcessingJobRow {
  id: string;
  media_id: string;
  job_kind: Generated<string>;
  processor_config_version: Generated<string>;
  state: Generated<string>;
  attempt: Generated<number>;
  revision: Generated<number>;
  queued_at: Date | null;
  updated_at: Generated<Date>;
}

export interface RelayDatabaseSchema {
  'platform.outbox_event': OutboxEventRow;
  'media.processing_job': ProcessingJobRow;
}
