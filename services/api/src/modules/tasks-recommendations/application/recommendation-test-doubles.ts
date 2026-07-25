/**
 * Shared in-memory test doubles for the recommendation-engine surface —
 * split out of `tasks-recommendations-test-doubles.ts` (which stays the
 * task-command half) so neither file crowds the 600-line budget. Not a
 * `*.test.ts` file; vitest never runs it as a suite.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GetGardenWeather } from '../../integrations/public.js';
import type {
  WeatherFreshnessPolicy,
  WeatherRecord,
  WeatherRecordKind,
  WeatherRecordRepository,
} from '../../integrations/public.js';
import type { RecommendationCandidate } from '../domain/recommendation-candidate.js';
import type { RecommendationEvidence } from '../domain/recommendation-evidence.js';
import { LIVE_RECOMMENDATION_CANDIDATE_STATES } from '../domain/recommendation-lifecycle.js';
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';
import type { RuleVersion } from '../domain/rule-version.js';
import type {
  RecommendationCandidateRepository,
  StoredCandidateWithRule,
} from './recommendation-candidate-repository.js';
import type { RuleVersionRepository } from './rule-version-repository.js';

export class FakeRuleVersionRepository implements RuleVersionRepository {
  readonly rows = new Map<Uuid, RuleVersion>();

  findByKeyAndVersion(ruleKey: string, version: number): Promise<RuleVersion | null> {
    for (const row of this.rows.values()) {
      if (row.ruleKey === ruleKey && row.version === version) {
        return Promise.resolve(row);
      }
    }
    return Promise.resolve(null);
  }

  async ensure(ruleVersion: RuleVersion): Promise<RuleVersion> {
    const existing = await this.findByKeyAndVersion(ruleVersion.ruleKey, ruleVersion.version);
    if (existing !== null) {
      return existing;
    }
    this.rows.set(ruleVersion.id, ruleVersion);
    return ruleVersion;
  }
}

/** In-memory candidate storage joined against a `FakeRuleVersionRepository` for the rule-identity reads the real repository performs with SQL joins. */
export class FakeRecommendationCandidateRepository implements RecommendationCandidateRepository {
  readonly candidates = new Map<Uuid, RecommendationCandidate>();
  readonly evidenceByCandidate = new Map<Uuid, readonly RecommendationEvidence[]>();
  readonly factorsByCandidate = new Map<Uuid, readonly RecommendationPriorityFactor[]>();
  lockedGardenIds: Uuid[] = [];

  constructor(private readonly ruleVersions: FakeRuleVersionRepository) {}

  lockGardenForEvaluation(gardenId: Uuid): Promise<void> {
    this.lockedGardenIds.push(gardenId);
    return Promise.resolve();
  }

  insertAggregate(
    aggregate: { candidate: RecommendationCandidate; evidence: readonly RecommendationEvidence[] },
    factors: readonly RecommendationPriorityFactor[],
  ): Promise<void> {
    this.candidates.set(aggregate.candidate.id, aggregate.candidate);
    this.evidenceByCandidate.set(aggregate.candidate.id, aggregate.evidence);
    this.factorsByCandidate.set(aggregate.candidate.id, factors);
    return Promise.resolve();
  }

  update(candidate: RecommendationCandidate, expectedRevision: number): Promise<boolean> {
    const existing = this.candidates.get(candidate.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.candidates.set(candidate.id, candidate);
    return Promise.resolve(true);
  }

  private withRule(candidate: RecommendationCandidate): StoredCandidateWithRule {
    const ruleVersion = this.ruleVersions.rows.get(candidate.ruleVersionId);
    if (ruleVersion === undefined) {
      throw new Error(`Fake candidate '${candidate.id}' references an unknown rule version.`);
    }
    return { candidate, ruleKey: ruleVersion.ruleKey, ruleVersion: ruleVersion.version };
  }

  listLiveForGarden(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]> {
    const live = [...this.candidates.values()]
      .filter(
        (candidate) =>
          candidate.gardenId === gardenId &&
          LIVE_RECOMMENDATION_CANDIDATE_STATES.includes(candidate.state),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(live.map((candidate) => this.withRule(candidate)));
  }

  listLatestPerRuleAndTarget(gardenId: Uuid): Promise<readonly StoredCandidateWithRule[]> {
    const latestByGroup = new Map<string, StoredCandidateWithRule>();
    for (const candidate of this.candidates.values()) {
      if (candidate.gardenId !== gardenId) {
        continue;
      }
      const stored = this.withRule(candidate);
      const groupKey = [
        stored.ruleKey,
        candidate.targetKind,
        candidate.targetGardenAreaMapObjectId ?? '',
        candidate.targetPlantId ?? '',
      ].join('|');
      const current = latestByGroup.get(groupKey);
      if (
        current === undefined ||
        candidate.createdAt.getTime() > current.candidate.createdAt.getTime()
      ) {
        latestByGroup.set(groupKey, stored);
      }
    }
    return Promise.resolve([...latestByGroup.values()]);
  }

  findWithRuleByIds(candidateIds: readonly Uuid[]): Promise<readonly StoredCandidateWithRule[]> {
    const found: StoredCandidateWithRule[] = [];
    for (const id of candidateIds) {
      const candidate = this.candidates.get(id);
      if (candidate !== undefined) {
        found.push(this.withRule(candidate));
      }
    }
    return Promise.resolve(found);
  }
}

/** In-memory `WeatherRecordRepository` serving `findLatest` by fetch order — enough to back a REAL `GetGardenWeather` (a concrete class, like `GardenAuthorization` in the sibling doubles file). */
export class FakeWeatherRecordRepository implements WeatherRecordRepository {
  readonly records: WeatherRecord[] = [];

  constructor(records: readonly WeatherRecord[] = []) {
    this.records.push(...records);
  }

  insertMany(records: readonly WeatherRecord[]): Promise<void> {
    this.records.push(...records);
    return Promise.resolve();
  }

  findLatest(gardenId: Uuid, kind: WeatherRecordKind): Promise<WeatherRecord | null> {
    const matching = this.records
      .filter((record) => record.gardenId === gardenId && record.kind === kind)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return Promise.resolve(matching[0] ?? null);
  }
}

/** A real `GetGardenWeather` over the in-memory record store — the "real concrete class over a fake port" construction. */
export function getGardenWeatherOver(
  records: readonly WeatherRecord[],
  freshnessPolicy: WeatherFreshnessPolicy,
  clock: Clock,
): GetGardenWeather {
  return new GetGardenWeather(new FakeWeatherRecordRepository(records), freshnessPolicy, clock);
}
