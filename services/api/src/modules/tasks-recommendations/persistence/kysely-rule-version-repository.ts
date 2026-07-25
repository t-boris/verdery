import type { Kysely } from 'kysely';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { RuleVersionRepository } from '../application/rule-version-repository.js';
import type { RecommendationSafetyTier, RuleVersion } from '../domain/rule-version.js';

interface RuleVersionRowLike {
  id: string;
  rule_key: string;
  version: number;
  safety_tier: string;
  created_at: Date;
}

function toRuleVersion(row: RuleVersionRowLike): RuleVersion {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    version: row.version,
    safetyTier: row.safety_tier as RecommendationSafetyTier,
    createdAt: row.created_at,
  };
}

export class KyselyRuleVersionRepository implements RuleVersionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findByKeyAndVersion(ruleKey: string, version: number): Promise<RuleVersion | null> {
    const row = await this.db
      .selectFrom('tasks_recommendations.rule_version')
      .selectAll()
      .where('rule_key', '=', ruleKey)
      .where('version', '=', version)
      .executeTakeFirst();
    return row === undefined ? null : toRuleVersion(row);
  }

  async ensure(ruleVersion: RuleVersion): Promise<RuleVersion> {
    // `ON CONFLICT (rule_key, version) DO NOTHING` then read back: the
    // stored row always wins, and a concurrent registration race resolves
    // in favor of whichever insert committed first — both callers read the
    // same winner.
    await this.db
      .insertInto('tasks_recommendations.rule_version')
      .values({
        id: ruleVersion.id,
        rule_key: ruleVersion.ruleKey,
        version: ruleVersion.version,
        safety_tier: ruleVersion.safetyTier,
        created_at: ruleVersion.createdAt,
      })
      .onConflict((conflict) => conflict.columns(['rule_key', 'version']).doNothing())
      .execute();

    const stored = await this.findByKeyAndVersion(ruleVersion.ruleKey, ruleVersion.version);
    if (stored === null) {
      throw new InternalError(
        'tasks_recommendations.rule_version.ensure_readback_failed',
        `Rule version '${ruleVersion.ruleKey}' v${String(ruleVersion.version)} is absent immediately after its idempotent insert.`,
      );
    }
    return stored;
  }
}
