/**
 * Kysely implementation of `ProviderQuotaRepository` over
 * `integrations.provider_quota_usage`.
 *
 * Atomicity: both window counters (UTC hour and UTC day) advance in ONE
 * transaction. Each advance is a conditional upsert —
 * `INSERT ... ON CONFLICT ... DO UPDATE SET call_count = call_count + 1
 * WHERE call_count < limit` — so the row-level lock the upsert takes makes
 * concurrent consumers serialize per window; when the guarded update
 * matches no row the budget is exhausted, the transaction rolls back (the
 * other window's increment is undone), and the caller gets a typed refusal.
 * An unlimited window (`null` limit) upserts without the guard: usage is
 * still counted, per section 14's observable "quota state".
 *
 * Source: architecture/external-integrations.md, section "14. Cost and
 * Quota"; migrations/1785700000000_integrations-weather-baseline.sql.
 */

import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  ProviderQuotaConsumeResult,
  ProviderQuotaLimits,
  ProviderQuotaRepository,
  ProviderQuotaWindowKind,
} from '../application/provider-quota-repository.js';
import { quotaWindowStart } from '../application/provider-quota-repository.js';

/** Internal control-flow signal: thrown inside the transaction to roll it back, always caught by `consumeCall` itself. */
class QuotaWindowExhausted extends Error {
  constructor(readonly window: ProviderQuotaWindowKind) {
    super(`quota window '${window}' exhausted`);
  }
}

export class KyselyProviderQuotaRepository implements ProviderQuotaRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async consumeCall(
    providerKey: string,
    limits: ProviderQuotaLimits,
    now: Date,
  ): Promise<ProviderQuotaConsumeResult> {
    const windows: readonly { kind: ProviderQuotaWindowKind; limit: number | null }[] = [
      { kind: 'hour', limit: limits.maxCallsPerHour },
      { kind: 'day', limit: limits.maxCallsPerDay },
    ];

    try {
      await this.db.transaction().execute(async (trx) => {
        for (const window of windows) {
          await this.advanceWindow(trx, providerKey, window.kind, window.limit, now);
        }
      });
    } catch (error) {
      if (error instanceof QuotaWindowExhausted) {
        return { consumed: false, exhaustedWindow: error.window };
      }
      throw error;
    }
    return { consumed: true };
  }

  private async advanceWindow(
    trx: Transaction<DatabaseSchema>,
    providerKey: string,
    kind: ProviderQuotaWindowKind,
    limit: number | null,
    now: Date,
  ): Promise<void> {
    // The fresh-insert path starts the window at 1, which must itself
    // respect a limit of 0-is-impossible (limits are validated positive),
    // so only the update path needs the guard.
    const inserted = await trx
      .insertInto('integrations.provider_quota_usage')
      .values({
        provider_key: providerKey,
        window_kind: kind,
        window_start: quotaWindowStart(kind, now),
        call_count: 1,
        updated_at: now,
      })
      .onConflict((oc) => {
        const update = oc.columns(['provider_key', 'window_kind', 'window_start']).doUpdateSet({
          call_count: sql<number>`integrations.provider_quota_usage.call_count + 1`,
          updated_at: now,
        });
        return limit === null
          ? update
          : update.where('integrations.provider_quota_usage.call_count', '<', limit);
      })
      .returning('call_count')
      .executeTakeFirst();

    if (inserted === undefined) {
      throw new QuotaWindowExhausted(kind);
    }
  }
}
