/**
 * Full-stack integration tests for P7-AI-01 against real PostgreSQL: the
 * sweep's embellishment phase (real unit of work, real verdict table,
 * real quota accounting) around a scriptable fake adapter, and the Today
 * surface serving — including the ROLLBACK evidence the work package
 * names: flipping the kill-switch off restores the exact baseline Today
 * response and provably makes zero provider calls.
 *
 * The fake adapter stands where live Vertex would: no Vertex access is
 * enabled in any environment (the coordinator's live-enablement gate),
 * and everything downstream of the adapter boundary — budget, deadline,
 * validation, persistence, serving, rollback — is the real stack.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyGeoreferenceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-georeference-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import {
  FakeAiExplanationProviderAdapter,
  SteppingClock,
} from '../../src/modules/integrations/application/integrations-test-doubles.js';
import {
  GenerateAiExplanation,
  GetGardenPrecipitation,
  GetGardenWeather,
  KyselyProviderQuotaRepository,
  KyselyWeatherRecordRepository,
} from '../../src/modules/integrations/public.js';
import {
  EmbellishRecommendationExplanations,
  EvaluateGardenRecommendations,
  GetTodayView,
  KyselyEvaluationGardenSource,
  KyselyTasksRecommendationsUnitOfWork,
  RunRecommendationEvaluationSweep,
  createLaunchRuleCatalog,
} from '../../src/modules/tasks-recommendations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'recommendation AI explanation integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const START = new Date('2026-07-25T09:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

/** A draft that passes validation against the harvest rule's baseline for a plant named "Ready tomato". */
const ACCEPTED_TEXT = 'Ready tomato looks ready — check ripeness and harvest what is ready.';

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let authorization: GardenAuthorization;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
    authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  /** Fresh garden + owner + one ready-to-harvest plant — the one launch rule that fires with no weather configured. */
  async function seedGarden(clock: SteppingClock, plantNames: readonly string[]) {
    const ownerId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({ id: ownerId, firebase_uid: `firebase-${ownerId}`, account_state: 'active' })
      .execute();
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'AI garden', generateUuidV7());
    for (const displayName of plantNames) {
      await db
        .insertInto('plants_inventory.plant')
        .values({
          id: randomUUID(),
          garden_id: garden.id,
          garden_area_map_object_id: null,
          placement_map_object_id: null,
          display_name: displayName,
          taxonomy_reference_id: null,
          variety_label: null,
          accepted_identification_id: null,
          acquisition_date: null,
          acquisition_date_type: null,
          quantity: null,
          lifecycle_stage: 'ready_to_harvest',
          status: 'active',
          condition_note: null,
          care_guidance_note: null,
          created_by_profile_id: ownerId,
          created_at: new Date(START.getTime() - 5 * DAY_MS),
          updated_at: new Date(START.getTime() - 5 * DAY_MS),
        })
        .execute();
    }
    return { ownerId, gardenId: garden.id };
  }

  /** One transaction: candidate ↔ evidence form a COMMIT-checked cycle, so both sides must leave together. */
  async function deleteAllGardens(): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('platform.outbox_event').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_ai_explanation').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_priority_factor').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_evidence').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_candidate').execute();
      await trx.deleteFrom('plants_inventory.plant').execute();
      await trx.deleteFrom('collaboration.membership').execute();
      await trx.deleteFrom('gardens_mapping.garden').execute();
    });
  }

  function makeSurface(
    clock: SteppingClock,
    adapter: FakeAiExplanationProviderAdapter | null,
    options: { providerKey?: string; maxCallsPerHour?: number | null } = {},
  ) {
    const unitOfWork = new KyselyTasksRecommendationsUnitOfWork(db, clock);
    const catalog = createLaunchRuleCatalog();
    const evaluate = new EvaluateGardenRecommendations(
      unitOfWork,
      catalog,
      new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock),
      new GetGardenPrecipitation(new KyselyWeatherRecordRepository(db)),
      new KyselyGeoreferenceRepository(db),
      clock,
    );
    const generate = new GenerateAiExplanation(
      adapter,
      {
        providerKey: options.providerKey ?? 'vertex-ai-explanation',
        callTimeoutMs: 1_000,
        quotaLimits: { maxCallsPerHour: options.maxCallsPerHour ?? null, maxCallsPerDay: null },
      },
      new KyselyProviderQuotaRepository(db),
      clock,
    );
    const embellisher =
      adapter === null
        ? null
        : new EmbellishRecommendationExplanations(unitOfWork, catalog, generate, 'en', clock);
    return {
      sweep: new RunRecommendationEvaluationSweep(
        new KyselyEvaluationGardenSource(db),
        evaluate,
        unitOfWork,
        embellisher,
        clock,
      ),
      todayOn: new GetTodayView(
        unitOfWork,
        authorization,
        catalog,
        { enabled: true, locale: 'en' },
        clock,
      ),
      todayOff: new GetTodayView(
        unitOfWork,
        authorization,
        catalog,
        { enabled: false, locale: 'en' },
        clock,
      ),
    };
  }

  it('embellishes end to end, is duplicate-safe on re-run, and the kill-switch restores the baseline response exactly', async () => {
    await deleteAllGardens();
    const clock = new SteppingClock(START);
    const { ownerId, gardenId } = await seedGarden(clock, ['Ready tomato']);
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'outcome',
      outcome: {
        kind: 'draft',
        draft: { explanation: ACCEPTED_TEXT, evidenceKeysUsed: ['plant.lifecycle_stage'] },
      },
    });
    const surface = makeSurface(clock, adapter);

    // Generation without AI first: the baseline Today response is captured
    // with the switch OFF, after first presentation settles the revision.
    const off = makeSurface(clock, null);
    const offSweep = await off.sweep.execute();
    expect(offSweep.candidatesCreated).toBe(1);
    expect(offSweep.embellishment).toBeNull();
    await off.todayOff.execute(gardenId, ownerId, 10);
    const baseline = await off.todayOff.execute(gardenId, ownerId, 10);
    expect(baseline.result.items[0]).toMatchObject({
      explanationSource: 'deterministic',
      embellishedExplanation: null,
    });

    // Switch ON: the sweep's embellishment phase covers the candidate.
    const onSweep = await surface.sweep.execute();
    expect(onSweep.embellishment).toMatchObject({
      candidatesConsidered: 1,
      accepted: 1,
      rejected: 0,
      stoppedOnQuotaExhaustion: false,
    });
    expect(adapter.callCount).toBe(1);
    expect(adapter.requests[0]).toMatchObject({
      ruleKey: 'lifecycle.harvest-readiness-check',
      locale: 'en',
      evidenceFacts: [
        { factKey: 'plant.lifecycle_stage', factValue: { lifecycleStage: 'ready_to_harvest' } },
      ],
    });

    const rows = await db
      .selectFrom('tasks_recommendations.recommendation_ai_explanation')
      .selectAll()
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      locale: 'en',
      provider_key: 'vertex-ai-explanation',
      model: 'fake-explanation-model',
      prompt_template_version: 1,
      packet_fact_keys: ['plant.lifecycle_stage'],
      generated_text: ACCEPTED_TEXT,
      validation_outcome: 'accepted',
    });

    // Serving ON: the embellishment rides the item; the deterministic
    // reason is untouched.
    const served = await surface.todayOn.execute(gardenId, ownerId, 10);
    expect(served.result.items[0]).toMatchObject({
      explanationSource: 'ai_embellished',
      embellishedExplanation: ACCEPTED_TEXT,
      explanation: baseline.result.items[0]?.explanation,
    });

    // Duplicate-safe: a re-run selects nothing and calls nothing.
    const repeat = await surface.sweep.execute();
    expect(repeat.embellishment).toMatchObject({ candidatesConsidered: 0, accepted: 0 });
    expect(adapter.callCount).toBe(1);

    // ROLLBACK: switch off again — the response equals the pre-AI baseline
    // byte for byte, and no provider call happened for it.
    const rolledBack = await off.todayOff.execute(gardenId, ownerId, 10);
    expect(rolledBack).toEqual(baseline);
    const offAgain = await off.sweep.execute();
    expect(offAgain.embellishment).toBeNull();
    expect(adapter.callCount).toBe(1);
  });

  it('MODEL OUTAGE end to end: a failing provider writes no verdict, Today keeps the deterministic reason, and the next sweep retries the same candidate', async () => {
    // P7-QA-01 model-outage case through the real sweep phase: section 14's
    // "retry only for safe transient outcomes" — a provider outage must
    // leave NO durable verdict (absence doubles as the retry marker), the
    // user-facing surface must keep functioning on the deterministic text,
    // and the very next run must retry the SAME candidate and succeed once
    // the provider recovers.
    await deleteAllGardens();
    const clock = new SteppingClock(START);
    const { ownerId, gardenId } = await seedGarden(clock, ['Outage tomato']);
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'fail',
      error: new Error('vertex unreachable'),
    });
    const surface = makeSurface(clock, adapter);

    // First sweep: generation succeeds, the embellishment phase hits the
    // outage — a counted transient, nothing stored.
    const outageRun = await surface.sweep.execute();
    expect(outageRun.candidatesCreated).toBe(1);
    expect(outageRun.embellishment).toMatchObject({
      candidatesConsidered: 1,
      accepted: 0,
      rejected: 0,
      transientFailures: 1,
    });
    expect(adapter.callCount).toBe(1);
    const verdictsAfterOutage = await db
      .selectFrom('tasks_recommendations.recommendation_ai_explanation')
      .selectAll()
      .execute();
    expect(verdictsAfterOutage).toHaveLength(0);

    // The application functions through the outage: Today serves the
    // deterministic reason with the AI path enabled and the provider down.
    const during = await surface.todayOn.execute(gardenId, ownerId, 10);
    expect(during.result.items[0]).toMatchObject({
      explanationSource: 'deterministic',
      embellishedExplanation: null,
    });

    // Provider recovers: the next scheduled run selects the SAME candidate
    // again (absence is the retry marker) and records the accepted verdict.
    adapter.setBehavior({
      kind: 'outcome',
      outcome: {
        kind: 'draft',
        draft: { explanation: ACCEPTED_TEXT, evidenceKeysUsed: ['plant.lifecycle_stage'] },
      },
    });
    const recoveredRun = await surface.sweep.execute();
    expect(recoveredRun.embellishment).toMatchObject({
      candidatesConsidered: 1,
      accepted: 1,
      transientFailures: 0,
    });
    expect(adapter.callCount).toBe(2);
    const served = await surface.todayOn.execute(gardenId, ownerId, 10);
    expect(served.result.items[0]).toMatchObject({
      explanationSource: 'ai_embellished',
      embellishedExplanation: ACCEPTED_TEXT,
    });
  });

  it('a rejected draft is recorded with its outcome and Today keeps serving the deterministic reason', async () => {
    await deleteAllGardens();
    const clock = new SteppingClock(START);
    const { ownerId, gardenId } = await seedGarden(clock, ['Ready tomato']);
    // Chemical vocabulary — prohibited regardless of baseline.
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'outcome',
      outcome: {
        kind: 'draft',
        draft: {
          explanation: 'Harvest it, and a fungicide spray will keep it fresh.',
          evidenceKeysUsed: ['plant.lifecycle_stage'],
        },
      },
    });
    const surface = makeSurface(clock, adapter, { providerKey: 'vertex-ai-rejection-test' });

    const sweep = await surface.sweep.execute();
    expect(sweep.embellishment).toMatchObject({
      accepted: 0,
      rejected: 1,
      rejectionOutcomes: { prohibited_content: 1 },
    });

    const rows = await db
      .selectFrom('tasks_recommendations.recommendation_ai_explanation')
      .select(['validation_outcome', 'generated_text'])
      .execute();
    expect(rows).toEqual([
      {
        validation_outcome: 'prohibited_content',
        generated_text: 'Harvest it, and a fungicide spray will keep it fresh.',
      },
    ]);

    const served = await surface.todayOn.execute(gardenId, ownerId, 10);
    expect(served.result.items[0]).toMatchObject({
      explanationSource: 'deterministic',
      embellishedExplanation: null,
    });
    // The durable verdict is never re-attempted.
    const repeat = await surface.sweep.execute();
    expect(repeat.embellishment).toMatchObject({ candidatesConsidered: 0 });
    expect(adapter.callCount).toBe(1);
  });

  it('an exhausted call budget stops the batch and the remainder drains after the window turns', async () => {
    await deleteAllGardens();
    const clock = new SteppingClock(START);
    await seedGarden(clock, ['Ready tomato', 'Second tomato']);
    const adapter = new FakeAiExplanationProviderAdapter({
      kind: 'outcome',
      outcome: {
        kind: 'draft',
        // Accepted against both plants' baselines: names no plant, adds
        // nothing beyond checking/harvesting.
        draft: {
          explanation: 'Looks ready — check ripeness and harvest what is ready.',
          evidenceKeysUsed: ['plant.lifecycle_stage'],
        },
      },
    });
    const surface = makeSurface(clock, adapter, {
      providerKey: 'vertex-ai-budget-test',
      maxCallsPerHour: 1,
    });

    const first = await surface.sweep.execute();
    expect(first.candidatesCreated).toBe(2);
    expect(first.embellishment).toMatchObject({
      candidatesConsidered: 2,
      accepted: 1,
      stoppedOnQuotaExhaustion: true,
    });
    expect(adapter.callCount).toBe(1);

    // Same window: still exhausted, still honest, zero further calls.
    const stillExhausted = await surface.sweep.execute();
    expect(stillExhausted.embellishment).toMatchObject({
      candidatesConsidered: 1,
      accepted: 0,
      stoppedOnQuotaExhaustion: true,
    });
    expect(adapter.callCount).toBe(1);

    // The next hour window drains the remainder — typed exhaustion is a
    // deferral, never a loss.
    clock.advanceMs(HOUR_MS + 1);
    const drained = await surface.sweep.execute();
    expect(drained.embellishment).toMatchObject({
      candidatesConsidered: 1,
      accepted: 1,
      stoppedOnQuotaExhaustion: false,
    });
    expect(adapter.callCount).toBe(2);
    const rows = await db
      .selectFrom('tasks_recommendations.recommendation_ai_explanation')
      .select(['validation_outcome'])
      .execute();
    expect(rows).toHaveLength(2);
  });
});
