import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  RecommendationCandidateRepository,
  StoredCandidateWithRule,
} from '../application/recommendation-candidate-repository.js';
import type {
  RecommendationCandidate,
  RecommendationCandidateAggregate,
  RecommendationTargetKind,
  RecommendationUrgency,
} from '../domain/recommendation-candidate.js';
import type { RecommendationCandidateState } from '../domain/recommendation-lifecycle.js';
import { LIVE_RECOMMENDATION_CANDIDATE_STATES } from '../domain/recommendation-lifecycle.js';
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';
import type { RecommendationSafetyTier } from '../domain/rule-version.js';

interface CandidateRowLike {
  id: string;
  garden_id: string;
  target_kind: string;
  target_garden_area_id: string | null;
  target_plant_id: string | null;
  care_category: string;
  rule_version_id: string;
  safety_tier: string;
  state: string;
  urgency: string;
  window_start: Date | null;
  window_end: Date | null;
  primary_evidence_id: string;
  supersedes_candidate_id: string | null;
  presented_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface CandidateWithRuleRowLike extends CandidateRowLike {
  rule_key: string;
  rule_version: number;
}

function toCandidate(row: CandidateRowLike): RecommendationCandidate {
  return {
    id: row.id,
    gardenId: row.garden_id,
    targetKind: row.target_kind as RecommendationTargetKind,
    targetGardenAreaMapObjectId: row.target_garden_area_id,
    targetPlantId: row.target_plant_id,
    careCategory: row.care_category,
    ruleVersionId: row.rule_version_id,
    safetyTier: row.safety_tier as RecommendationSafetyTier,
    state: row.state as RecommendationCandidateState,
    urgency: row.urgency as RecommendationUrgency,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    primaryEvidenceId: row.primary_evidence_id,
    supersedesCandidateId: row.supersedes_candidate_id,
    presentedAt: row.presented_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStored(row: CandidateWithRuleRowLike): StoredCandidateWithRule {
  return { candidate: toCandidate(row), ruleKey: row.rule_key, ruleVersion: row.rule_version };
}

const CANDIDATE_WITH_RULE_COLUMNS = [
  'candidate.id',
  'candidate.garden_id',
  'candidate.target_kind',
  'candidate.target_garden_area_id',
  'candidate.target_plant_id',
  'candidate.care_category',
  'candidate.rule_version_id',
  'candidate.safety_tier',
  'candidate.state',
  'candidate.urgency',
  'candidate.window_start',
  'candidate.window_end',
  'candidate.primary_evidence_id',
  'candidate.supersedes_candidate_id',
  'candidate.presented_at',
  'candidate.revision',
  'candidate.created_at',
  'candidate.updated_at',
  'rule.rule_key',
  'rule.version as rule_version',
] as const;

export class KyselyRecommendationCandidateRepository implements RecommendationCandidateRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async lockGardenForEvaluation(gardenId: Uuid): Promise<void> {
    // A transaction-scoped advisory lock keyed by garden: concurrent
    // evaluations of the same garden serialize; different gardens do not
    // contend. Released automatically at COMMIT/ROLLBACK.
    await sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('tasks_recommendations.evaluate:' || ${gardenId}, 0)
      )
    `.execute(this.db);
  }

  async insertAggregate(
    aggregate: RecommendationCandidateAggregate,
    factors: readonly RecommendationPriorityFactor[],
  ): Promise<void> {
    const { candidate, evidence } = aggregate;
    // Candidate first, evidence second: the composite primary-evidence FK
    // is DEFERRABLE INITIALLY DEFERRED, checked at COMMIT across both.
    await this.db
      .insertInto('tasks_recommendations.recommendation_candidate')
      .values({
        id: candidate.id,
        garden_id: candidate.gardenId,
        target_kind: candidate.targetKind,
        target_garden_area_id: candidate.targetGardenAreaMapObjectId,
        target_plant_id: candidate.targetPlantId,
        care_category: candidate.careCategory,
        rule_version_id: candidate.ruleVersionId,
        safety_tier: candidate.safetyTier,
        state: candidate.state,
        urgency: candidate.urgency,
        window_start: candidate.windowStart,
        window_end: candidate.windowEnd,
        primary_evidence_id: candidate.primaryEvidenceId,
        supersedes_candidate_id: candidate.supersedesCandidateId,
        presented_at: candidate.presentedAt,
        revision: candidate.revision,
        created_at: candidate.createdAt,
        updated_at: candidate.updatedAt,
      })
      .execute();

    await this.db
      .insertInto('tasks_recommendations.recommendation_evidence')
      .values(
        evidence.map((item) => ({
          id: item.id,
          candidate_id: item.candidateId,
          evidence_kind: item.kind,
          source_observation_id: item.sourceObservationId,
          source_task_id: item.sourceTaskId,
          source_plant_id: item.sourcePlantId,
          source_weather_record_id: item.sourceWeatherRecordId,
          fact_key: item.factKey,
          fact_value: item.factValue === null ? null : JSON.stringify(item.factValue),
          created_at: item.createdAt,
        })),
      )
      .execute();

    if (factors.length > 0) {
      await this.db
        .insertInto('tasks_recommendations.recommendation_priority_factor')
        .values(
          factors.map((factor) => ({
            id: factor.id,
            candidate_id: factor.candidateId,
            factor_kind: factor.factorKind,
            factor_value: JSON.stringify(factor.factorValue),
            created_at: factor.createdAt,
          })),
        )
        .execute();
    }
  }

  async update(candidate: RecommendationCandidate, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('tasks_recommendations.recommendation_candidate')
      .set({
        state: candidate.state,
        presented_at: candidate.presentedAt,
        revision: candidate.revision,
        updated_at: candidate.updatedAt,
      })
      .where('id', '=', candidate.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();
    return (result?.numUpdatedRows ?? 0n) === 1n;
  }

  async listLiveForGarden(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]> {
    const rows = await this.db
      .selectFrom('tasks_recommendations.recommendation_candidate as candidate')
      .innerJoin(
        'tasks_recommendations.rule_version as rule',
        'rule.id',
        'candidate.rule_version_id',
      )
      .select(CANDIDATE_WITH_RULE_COLUMNS)
      .where('candidate.garden_id', '=', gardenId)
      .where('candidate.state', 'in', [...LIVE_RECOMMENDATION_CANDIDATE_STATES])
      .orderBy('candidate.created_at', 'asc')
      .orderBy('candidate.id', 'asc')
      .execute();
    return rows.map(toStored);
  }

  async listLatestPerRuleAndTarget(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]> {
    // DISTINCT ON picks the newest row per (rule key, target); NULL target
    // columns compare equal under DISTINCT ON, which is exactly right for
    // garden-kind targets.
    const rows = await this.db
      .selectFrom('tasks_recommendations.recommendation_candidate as candidate')
      .innerJoin(
        'tasks_recommendations.rule_version as rule',
        'rule.id',
        'candidate.rule_version_id',
      )
      .distinctOn([
        'rule.rule_key',
        'candidate.target_kind',
        'candidate.target_garden_area_id',
        'candidate.target_plant_id',
      ])
      .select(CANDIDATE_WITH_RULE_COLUMNS)
      .where('candidate.garden_id', '=', gardenId)
      .orderBy('rule.rule_key', 'asc')
      .orderBy('candidate.target_kind', 'asc')
      .orderBy('candidate.target_garden_area_id', 'asc')
      .orderBy('candidate.target_plant_id', 'asc')
      .orderBy('candidate.created_at', 'desc')
      .orderBy('candidate.id', 'desc')
      .execute();
    return rows.map(toStored);
  }

  async findWithRuleByIds(
    candidateIds: readonly Uuid[],
  ): Promise<readonly StoredCandidateWithRule[]> {
    if (candidateIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom('tasks_recommendations.recommendation_candidate as candidate')
      .innerJoin(
        'tasks_recommendations.rule_version as rule',
        'rule.id',
        'candidate.rule_version_id',
      )
      .select(CANDIDATE_WITH_RULE_COLUMNS)
      .where('candidate.id', 'in', [...candidateIds])
      .execute();
    return rows.map(toStored);
  }
}
