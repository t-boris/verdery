/**
 * Kysely implementation of {@link PurgeExecutor} (P8-DELETE-01).
 *
 * BATCHING BY `ctid`: the deleted set is selected as a bounded page of
 * physical row identifiers, then deleted by identity. This works for every
 * step's predicate without any step declaring a key, an ordering, or a
 * cursor — which is what lets the plan stay pure data. It is Postgres-specific,
 * as is the rest of this service (PostGIS geometry, `similarity()`, partial
 * unique indexes), so nothing portable is being given up.
 *
 * WHY BATCH AT ALL: a mature garden's revision journals are the largest sets
 * here, and a single unbounded `DELETE` over them would hold row locks and
 * grow one transaction's WAL for as long as it took. Each batch is its own
 * statement inside the step's transaction, and each STEP is its own
 * transaction (see `run-purge.ts`), so the longest lock any purge holds is
 * one step of one subject.
 *
 * WHY THE LOOP IS SAFE TO INTERRUPT: every batch deletes rows that satisfy
 * the step's predicate, and nothing re-creates them — the subject stopped
 * accepting writes the moment deletion was requested. A crash mid-loop leaves
 * a partially drained step whose next run simply continues; the recorded
 * count is only written when the step reaches zero.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { PurgeExecutor } from '../application/purge-executor.js';
import type { PurgePreparation, PurgeStep } from '../application/purge-plan.js';

export class KyselyPurgeExecutor implements PurgeExecutor {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async deleteAll(step: PurgeStep, subjectId: string, batchSize: number): Promise<number> {
    let total = 0;

    for (;;) {
      const result = await sql`
        DELETE FROM ${sql.table(step.table)}
        WHERE ctid IN (
          SELECT ctid FROM ${sql.table(step.table)}
          WHERE ${step.rows(subjectId)}
          LIMIT ${sql.lit(batchSize)}
        )
      `.execute(this.db);

      const deleted = Number(result.numAffectedRows ?? 0n);
      total += deleted;

      if (deleted < batchSize) {
        return total;
      }
    }
  }

  async prepare(preparation: PurgePreparation, subjectId: string): Promise<number> {
    const result = await preparation.statement(subjectId).execute(this.db);
    return Number(result.numAffectedRows ?? 0n);
  }
}
