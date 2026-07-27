/**
 * Shared in-memory test doubles for the recommendation-engine surface —
 * split out of `tasks-recommendations-test-doubles.ts` (which stays the
 * task-command half) so neither file crowds the 600-line budget. Not a
 * `*.test.ts` file; vitest never runs it as a suite.
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Georeference, GeoreferenceRepository } from '../../gardens-mapping/public.js';
import { GetGardenWeather } from '../../integrations/public.js';
import type {
  AiExplanationLocale,
  WeatherFreshnessPolicy,
  WeatherRecord,
  WeatherRecordKind,
  WeatherRecordRepository,
} from '../../integrations/public.js';
import type { AiExplanationRecord } from '../domain/ai-explanation.js';
import type { AiExplanationRecordRepository } from './ai-explanation-record-repository.js';
import type { RecommendationCandidate } from '../domain/recommendation-candidate.js';
import type { RecommendationEvidence } from '../domain/recommendation-evidence.js';
import type { RecommendationFeedback } from '../domain/recommendation-feedback.js';
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
  readonly feedback: RecommendationFeedback[] = [];
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

  private withRule(
    candidate: RecommendationCandidate,
    options: { readonly withPostponedUntil: boolean } = { withPostponedUntil: false },
  ): StoredCandidateWithRule {
    const ruleVersion = this.ruleVersions.rows.get(candidate.ruleVersionId);
    if (ruleVersion === undefined) {
      throw new Error(`Fake candidate '${candidate.id}' references an unknown rule version.`);
    }
    // The latest `postponed` feedback row's horizon — only the
    // `listLatestPerRuleAndTarget` read resolves it, per the port's doc.
    const postponedUntil = options.withPostponedUntil
      ? ([...this.feedback]
          .filter((row) => row.candidateId === candidate.id && row.kind === 'postponed')
          .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0]?.postponedUntil ??
        null)
      : null;
    return {
      candidate,
      ruleKey: ruleVersion.ruleKey,
      ruleVersion: ruleVersion.version,
      postponedUntil,
    };
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
      const stored = this.withRule(candidate, { withPostponedUntil: true });
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

  listGardenIdsWithExpirableCandidates(now: Date, limit: number): Promise<readonly Uuid[]> {
    const gardenIds = new Set<Uuid>();
    for (const candidate of this.candidates.values()) {
      if (
        LIVE_RECOMMENDATION_CANDIDATE_STATES.includes(candidate.state) &&
        candidate.windowEnd !== null &&
        candidate.windowEnd.getTime() <= now.getTime()
      ) {
        gardenIds.add(candidate.gardenId);
      }
    }
    return Promise.resolve([...gardenIds].sort().slice(0, limit));
  }

  listPresentableForGarden(gardenId: Uuid, now: Date): Promise<readonly StoredCandidateWithRule[]> {
    const presentable = [...this.candidates.values()]
      .filter(
        (candidate) =>
          candidate.gardenId === gardenId &&
          (candidate.state === 'eligible' || candidate.state === 'presented') &&
          (candidate.windowStart === null || candidate.windowStart.getTime() <= now.getTime()) &&
          (candidate.windowEnd === null || candidate.windowEnd.getTime() >= now.getTime()),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return Promise.resolve(presentable.map((candidate) => this.withRule(candidate)));
  }

  listFactorsForCandidates(
    candidateIds: readonly Uuid[],
  ): Promise<readonly RecommendationPriorityFactor[]> {
    const factors: RecommendationPriorityFactor[] = [];
    for (const id of candidateIds) {
      factors.push(...(this.factorsByCandidate.get(id) ?? []));
    }
    return Promise.resolve(factors);
  }

  listEvidenceForCandidates(
    candidateIds: readonly Uuid[],
  ): Promise<readonly RecommendationEvidence[]> {
    const evidence: RecommendationEvidence[] = [];
    for (const id of candidateIds) {
      evidence.push(...(this.evidenceByCandidate.get(id) ?? []));
    }
    return Promise.resolve(evidence);
  }

  appendFeedback(feedback: RecommendationFeedback): Promise<void> {
    this.feedback.push(feedback);
    return Promise.resolve();
  }

  listFeedbackForCandidate(candidateId: Uuid): Promise<readonly RecommendationFeedback[]> {
    const rows = this.feedback
      .filter((row) => row.candidateId === candidateId)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
    return Promise.resolve(rows);
  }
}

export interface SeedRecommendationCandidateInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly state?: RecommendationCandidate['state'];
  readonly ruleKey?: string;
  readonly ruleVersion?: number;
  readonly urgency?: RecommendationCandidate['urgency'];
  readonly targetPlantId?: Uuid | null;
  readonly windowStart?: Date | null;
  readonly windowEnd?: Date | null;
  readonly explanation?: string | null;
  readonly presentedAt?: Date | null;
  readonly revision?: number;
  readonly createdAt?: Date;
  readonly factors?: readonly {
    kind: RecommendationPriorityFactor['factorKind'];
    contribution: number;
  }[];
}

/**
 * Seeds one stored candidate (with its rule version, one evidence row, and
 * optional `{ contribution, basis }` factor rows) into the fake
 * repositories — the P7-BE-01 command/query tests' shared fixture shape.
 */
export function seedRecommendationCandidate(
  candidates: FakeRecommendationCandidateRepository,
  ruleVersions: FakeRuleVersionRepository,
  input: SeedRecommendationCandidateInput,
): RecommendationCandidate {
  const ruleKey = input.ruleKey ?? 'lifecycle.harvest-readiness-check';
  const ruleVersion = input.ruleVersion ?? 1;
  const existing = [...ruleVersions.rows.values()].find(
    (row) => row.ruleKey === ruleKey && row.version === ruleVersion,
  );
  const versionRow = existing ?? {
    id: generateUuidV7(),
    ruleKey,
    version: ruleVersion,
    safetyTier: 'ordinary_care' as const,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
  if (existing === undefined) {
    ruleVersions.rows.set(versionRow.id, versionRow);
  }

  const createdAt = input.createdAt ?? new Date('2026-07-24T09:00:00Z');
  const evidenceId = generateUuidV7();
  const targetPlantId = input.targetPlantId === undefined ? null : input.targetPlantId;
  const candidate: RecommendationCandidate = {
    id: input.id,
    gardenId: input.gardenId,
    targetKind: targetPlantId === null ? 'garden' : 'plant',
    targetGardenAreaMapObjectId: null,
    targetPlantId,
    careCategory: 'harvest',
    explanation:
      input.explanation === undefined ? 'Stored deterministic explanation.' : input.explanation,
    ruleVersionId: versionRow.id,
    safetyTier: 'ordinary_care',
    state: input.state ?? 'eligible',
    urgency: input.urgency ?? 'high',
    windowStart: input.windowStart === undefined ? createdAt : input.windowStart,
    windowEnd:
      input.windowEnd === undefined
        ? new Date(createdAt.getTime() + 5 * 24 * 60 * 60 * 1000)
        : input.windowEnd,
    primaryEvidenceId: evidenceId,
    supersedesCandidateId: null,
    presentedAt: input.presentedAt ?? null,
    revision: input.revision ?? 2,
    createdAt,
    updatedAt: createdAt,
  };
  candidates.candidates.set(candidate.id, candidate);
  candidates.evidenceByCandidate.set(candidate.id, [
    {
      id: evidenceId,
      candidateId: candidate.id,
      kind: targetPlantId === null ? 'garden_context' : 'lifecycle_stage',
      sourceObservationId: null,
      sourceTaskId: null,
      sourcePlantId: targetPlantId,
      sourceWeatherRecordId: null,
      factKey: 'seed.fact',
      factValue: { seeded: true },
      createdAt,
    },
  ]);
  if (input.factors !== undefined) {
    candidates.factorsByCandidate.set(
      candidate.id,
      input.factors.map((factor) => ({
        id: generateUuidV7(),
        candidateId: candidate.id,
        factorKind: factor.kind,
        factorValue: { contribution: factor.contribution, basis: { seeded: true } },
        createdAt,
      })),
    );
  }
  return candidate;
}

/**
 * In-memory `AiExplanationRecordRepository` (P7-AI-01) joined against the
 * candidate fake for the selection read. `readCalls` counts EVERY read —
 * the kill-switch tests prove "the verdict table is not even read" by it
 * staying at zero.
 */
export class FakeAiExplanationRecordRepository implements AiExplanationRecordRepository {
  readonly records: AiExplanationRecord[] = [];
  readCalls = 0;

  constructor(private readonly candidates: FakeRecommendationCandidateRepository) {}

  insertIfAbsent(record: AiExplanationRecord): Promise<boolean> {
    const exists = this.records.some(
      (row) => row.candidateId === record.candidateId && row.locale === record.locale,
    );
    if (exists) {
      return Promise.resolve(false);
    }
    this.records.push(record);
    return Promise.resolve(true);
  }

  listAcceptedForCandidates(
    candidateIds: readonly Uuid[],
    locale: AiExplanationLocale,
  ): Promise<readonly AiExplanationRecord[]> {
    this.readCalls += 1;
    const ids = new Set(candidateIds);
    return Promise.resolve(
      this.records.filter(
        (row) =>
          ids.has(row.candidateId) && row.locale === locale && row.validationOutcome === 'accepted',
      ),
    );
  }

  listEmbellishableCandidateIds(
    locale: AiExplanationLocale,
    now: Date,
    limit: number,
  ): Promise<readonly Uuid[]> {
    this.readCalls += 1;
    const recorded = new Set(
      this.records.filter((row) => row.locale === locale).map((row) => row.candidateId),
    );
    const ids = [...this.candidates.candidates.values()]
      .filter(
        (candidate) =>
          (candidate.state === 'eligible' || candidate.state === 'presented') &&
          candidate.explanation !== null &&
          (candidate.windowStart === null || candidate.windowStart.getTime() <= now.getTime()) &&
          (candidate.windowEnd === null || candidate.windowEnd.getTime() >= now.getTime()) &&
          !recorded.has(candidate.id),
      )
      .map((candidate) => candidate.id)
      .sort()
      .slice(0, limit);
    return Promise.resolve(ids);
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

/**
 * In-memory `GeoreferenceRepository` (P9D-SEASON-DATA-01) — one optional
 * `Georeference` per garden, `null` meaning "never georeferenced", plus a
 * call log so a test can prove `EvaluateGardenRecommendations` actually
 * consults this port for the garden it is evaluating (the "wiring" proof;
 * `deriveHemisphere`'s own domain-level unit tests in `garden-facts.test.ts`
 * cover the derivation itself, and a real-Postgres proof lives in
 * `tests/integration/garden-hemisphere.test.ts`).
 */
export class FakeGeoreferenceRepository implements GeoreferenceRepository {
  readonly byGardenId = new Map<Uuid, Georeference>();
  readonly calls: Uuid[] = [];

  findCurrentForGarden(gardenId: Uuid): Promise<Georeference | null> {
    this.calls.push(gardenId);
    return Promise.resolve(this.byGardenId.get(gardenId) ?? null);
  }
}
