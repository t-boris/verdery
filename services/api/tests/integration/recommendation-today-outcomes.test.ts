/**
 * P7-BE-01's acceptance evidence — "Priority and outcome history tests" —
 * end to end against real PostgreSQL: the engine generates candidates, the
 * Today query orders them by the score re-derived from the STORED priority
 * factors and marks first presentation, the feedback commands and the task
 * conversion drive the lifecycle with an append-only feedback trail, and
 * the resulting rows form the queryable care-loop evidence chain:
 *
 *   candidate (presented_at) -> feedback rows -> converted task
 *   (origin_recommendation_id) -> engine suppression by that open task ->
 *   postponed candidate -> engine re-surfacing via a NEW candidate
 *   referencing it (supersedes_candidate_id) -> its own outcome.
 *
 * Source: implementation-plan.md work package P7-BE-01;
 * architecture/recommendations-and-ai.md, sections 6, 7, 16, 17.
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { SteppingClock } from '../../src/modules/integrations/application/integrations-test-doubles.js';
import {
  GetGardenWeather,
  KyselyWeatherRecordRepository,
} from '../../src/modules/integrations/public.js';
import {
  CompleteRecommendation,
  ConvertRecommendationToTask,
  DismissRecommendation,
  EvaluateGardenRecommendations,
  GetTodayView,
  KyselyRecommendationCandidateRepository,
  KyselyTasksRecommendationsUnitOfWork,
  MarkRecommendationIrrelevant,
  PostponeRecommendation,
  createLaunchRuleCatalog,
} from '../../src/modules/tasks-recommendations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'recommendation Today and outcome history integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const START = new Date('2026-07-25T09:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

const HARVEST_EXPLANATION =
  'Tomato is marked ready to harvest. Check ripeness and harvest what is ready ' +
  'before the window passes.';

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let authorization: GardenAuthorization;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
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

  async function createGardenWithOwner(clock: SteppingClock) {
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
    const garden = await createGarden.execute(ownerId, 'Care-loop garden', generateUuidV7());
    return { ownerId, gardenId: garden.id };
  }

  async function insertPlant(
    gardenId: string,
    ownerId: string,
    displayName: string,
    lifecycleStage: string,
    createdAt: Date,
  ): Promise<string> {
    const plantId = randomUUID();
    await db
      .insertInto('plants_inventory.plant')
      .values({
        id: plantId,
        garden_id: gardenId,
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        display_name: displayName,
        taxonomy_reference_id: null,
        variety_label: null,
        accepted_identification_id: null,
        acquisition_date: null,
        acquisition_date_type: null,
        quantity: null,
        lifecycle_stage: lifecycleStage,
        status: 'active',
        condition_note: null,
        care_guidance_note: null,
        created_by_profile_id: ownerId,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute();
    return plantId;
  }

  function makeSurface(clock: SteppingClock) {
    const unitOfWork = new KyselyTasksRecommendationsUnitOfWork(db, clock);
    const catalog = createLaunchRuleCatalog();
    const candidates = new KyselyRecommendationCandidateRepository(db);
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const feedbackDeps = { candidates, idempotency, unitOfWork, authorization, clock };
    return {
      evaluate: new EvaluateGardenRecommendations(
        unitOfWork,
        catalog,
        new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock),
        clock,
      ),
      today: new GetTodayView(
        unitOfWork,
        authorization,
        catalog,
        { enabled: false, locale: 'en' },
        clock,
      ),
      complete: new CompleteRecommendation(feedbackDeps),
      postpone: new PostponeRecommendation(feedbackDeps),
      dismiss: new DismissRecommendation(feedbackDeps),
      markIrrelevant: new MarkRecommendationIrrelevant(feedbackDeps),
      convert: new ConvertRecommendationToTask(
        candidates,
        idempotency,
        unitOfWork,
        authorization,
        catalog,
        clock,
      ),
      candidates,
    };
  }

  it('runs the whole care loop and leaves a queryable outcome history', async () => {
    const clock = new SteppingClock(START);
    const { ownerId, gardenId } = await createGardenWithOwner(clock);
    // Plant A fires the harvest rule (priority 75); plant B, unobserved for
    // 20 days, fires the observation reminder (priority 40).
    const tomatoId = await insertPlant(
      gardenId,
      ownerId,
      'Tomato',
      'ready_to_harvest',
      new Date(START.getTime() - 5 * DAY_MS),
    );
    const basilId = await insertPlant(
      gardenId,
      ownerId,
      'Basil',
      'growing',
      new Date(START.getTime() - 20 * DAY_MS),
    );

    const surface = makeSurface(clock);
    const generated = await surface.evaluate.execute({ gardenId });
    expect(generated.createdCandidates).toHaveLength(2);

    // ---- The Today query: stored-factor priority order, first presentation.
    const today = await surface.today.execute(gardenId, ownerId, 10);
    expect(today.items.map((item) => [item.ruleKey, item.priorityScore])).toEqual([
      ['lifecycle.harvest-readiness-check', 75],
      ['observation.routine-check-reminder', 40],
    ]);
    const [harvestItem, reminderItem] = today.items;
    expect(harvestItem).toMatchObject({
      state: 'presented',
      urgency: 'high',
      targetPlantId: tomatoId,
      targetDisplayName: 'Tomato',
      actionTitle: 'Check ripeness and harvest what is ready',
      explanation: HARVEST_EXPLANATION,
      presentedAt: START.toISOString(),
      revision: 3,
    });
    expect(reminderItem).toMatchObject({
      state: 'presented',
      targetPlantId: basilId,
      targetDisplayName: 'Basil',
      explanation:
        'Basil has not been observed for 20 days. Record a quick check of its condition.',
    });
    expect(harvestItem?.evidence).toEqual([
      expect.objectContaining({ kind: 'lifecycle_stage', sourcePlantId: tomatoId }),
    ]);
    expect(harvestItem?.priorityFactors.map((factor) => factor.kind).sort()).toEqual([
      'confidence',
      'plant_impact',
      'urgency_window',
    ]);

    // The presentation is recorded once: a repeat read transitions nothing.
    const repeat = await surface.today.execute(gardenId, ownerId, 10);
    expect(repeat.items.map((item) => item.revision)).toEqual([3, 3]);

    // ---- Task conversion: candidate completed + feedback + linked task, one transaction.
    const harvestId = harvestItem?.id ?? '';
    const conversion = await surface.convert.execute(
      gardenId,
      harvestId,
      ownerId,
      3,
      generateUuidV7(),
    );
    expect(conversion.recommendation).toMatchObject({ state: 'completed', revision: 4 });
    expect(conversion.task).toMatchObject({
      title: 'Check ripeness and harvest what is ready',
      notes: HARVEST_EXPLANATION,
      status: 'planned',
      source: 'suggested',
      urgency: 'high',
      targetPlantId: tomatoId,
      originRecommendationId: harvestId,
    });

    // The chain in rows: presented -> completed candidate, its feedback row,
    // the task pointing back, journaled and sync-recorded like any task.
    const harvestRow = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(['state', 'presented_at', 'revision', 'explanation'])
      .where('id', '=', harvestId)
      .executeTakeFirstOrThrow();
    expect(harvestRow).toEqual({
      state: 'completed',
      presented_at: START,
      revision: 4,
      explanation: HARVEST_EXPLANATION,
    });
    const harvestFeedback = await db
      .selectFrom('tasks_recommendations.recommendation_feedback')
      .select(['feedback_kind', 'actor_profile_id', 'postponed_until'])
      .where('candidate_id', '=', harvestId)
      .execute();
    expect(harvestFeedback).toEqual([
      { feedback_kind: 'completed', actor_profile_id: ownerId, postponed_until: null },
    ]);
    const taskRow = await db
      .selectFrom('tasks_recommendations.task')
      .selectAll()
      .where('origin_recommendation_id', '=', harvestId)
      .executeTakeFirstOrThrow();
    expect(taskRow).toMatchObject({
      id: conversion.task.id,
      source: 'suggested',
      status: 'planned',
      title: 'Check ripeness and harvest what is ready',
      notes: HARVEST_EXPLANATION,
    });
    const journal = await db
      .selectFrom('tasks_recommendations.task_revision')
      .select(['command_type', 'status'])
      .where('task_id', '=', conversion.task.id)
      .execute();
    expect(journal).toEqual([{ command_type: 'convertRecommendationToTask', status: 'planned' }]);
    const syncChange = await db
      .selectFrom('platform.sync_change')
      .select(['record_type', 'operation', 'record_revision'])
      .where('record_id', '=', conversion.task.id)
      .execute();
    expect(syncChange).toEqual([{ record_type: 'task', operation: 'upsert', record_revision: 1 }]);

    // ---- Postponement with a user horizon.
    const reminderId = reminderItem?.id ?? '';
    const horizon = new Date(START.getTime() + 2 * DAY_MS);
    const postponed = await surface.postpone.execute(
      gardenId,
      reminderId,
      ownerId,
      3,
      horizon,
      generateUuidV7(),
    );
    expect(postponed).toMatchObject({ state: 'postponed', revision: 4 });

    // ---- One day on: the converted OPEN task suppresses the harvest rule
    // (provable equivalence via origin_recommendation_id), and the postponed
    // reminder awaits its horizon — the evaluation creates nothing.
    clock.advanceMs(DAY_MS);
    const dayOne = await surface.evaluate.execute({ gardenId });
    expect(dayOne.createdCandidates).toEqual([]);
    expect(dayOne.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'targetSuppressed',
          ruleKey: 'lifecycle.harvest-readiness-check',
          reason: expect.objectContaining({
            kind: 'openTaskExists',
            taskId: conversion.task.id,
          }) as unknown,
        }),
        expect.objectContaining({
          kind: 'targetSuppressed',
          ruleKey: 'observation.routine-check-reminder',
          reason: expect.objectContaining({
            kind: 'postponedAwaitingResurface',
            priorCandidateId: reminderId,
            resurfaceAt: horizon,
          }) as unknown,
        }),
      ]),
    );

    // ---- Past the horizon: the engine re-surfaces the reminder as a NEW
    // candidate referencing the postponed record, which stays untouched.
    clock.advanceMs(2 * DAY_MS);
    const dayThree = await surface.evaluate.execute({ gardenId });
    expect(dayThree.createdCandidates).toHaveLength(1);
    const resurfaced = dayThree.createdCandidates[0];
    expect(resurfaced).toMatchObject({
      ruleKey: 'observation.routine-check-reminder',
      supersedesCandidateId: reminderId,
      supersededLivePrior: false,
    });
    const postponedRow = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(['state', 'revision'])
      .where('id', '=', reminderId)
      .executeTakeFirstOrThrow();
    expect(postponedRow).toEqual({ state: 'postponed', revision: 4 });

    // ---- The re-surfaced candidate runs its own loop: presented, dismissed,
    // then flagged irrelevant — feedback-only, no revision bump.
    const resurfacedId = resurfaced?.candidateId ?? '';
    const todayAfter = await surface.today.execute(gardenId, ownerId, 10);
    expect(todayAfter.items.map((item) => item.id)).toEqual([resurfacedId]);
    expect(todayAfter.items[0]).toMatchObject({
      supersedesCandidateId: reminderId,
      explanation:
        'Basil has not been observed for 23 days. Record a quick check of its condition.',
    });

    const dismissed = await surface.dismiss.execute(
      gardenId,
      resurfacedId,
      ownerId,
      3,
      generateUuidV7(),
    );
    expect(dismissed).toMatchObject({ state: 'rejected', revision: 4 });
    const flagged = await surface.markIrrelevant.execute(
      gardenId,
      resurfacedId,
      ownerId,
      4,
      generateUuidV7(),
    );
    expect(flagged).toMatchObject({ state: 'rejected', revision: 4 });

    // ---- The full outcome history, read back from rows alone: every
    // candidate outcome, its feedback trail, the supersession link, and the
    // converted task — section 16's "user outcomes feed product quality
    // analysis" as one queryable chain.
    const candidateHistory = await db
      .selectFrom('tasks_recommendations.recommendation_candidate as candidate')
      .leftJoin(
        'tasks_recommendations.task as task',
        'task.origin_recommendation_id',
        'candidate.id',
      )
      .select([
        'candidate.id',
        'candidate.state',
        'candidate.supersedes_candidate_id',
        'task.id as converted_task_id',
      ])
      .where('candidate.garden_id', '=', gardenId)
      .orderBy('candidate.created_at', 'asc')
      .orderBy('candidate.id', 'asc')
      .execute();
    // Creation order within the first evaluation is catalog order — the
    // observation reminder precedes the harvest rule, so its UUIDv7 sorts
    // first at the shared created_at instant.
    expect(candidateHistory).toEqual([
      {
        id: reminderId,
        state: 'postponed',
        supersedes_candidate_id: null,
        converted_task_id: null,
      },
      {
        id: harvestId,
        state: 'completed',
        supersedes_candidate_id: null,
        converted_task_id: conversion.task.id,
      },
      {
        id: resurfacedId,
        state: 'rejected',
        supersedes_candidate_id: reminderId,
        converted_task_id: null,
      },
    ]);
    const feedbackTrail = await db
      .selectFrom('tasks_recommendations.recommendation_feedback as feedback')
      .innerJoin(
        'tasks_recommendations.recommendation_candidate as candidate',
        'candidate.id',
        'feedback.candidate_id',
      )
      .select(['feedback.candidate_id', 'feedback.feedback_kind', 'feedback.postponed_until'])
      .where('candidate.garden_id', '=', gardenId)
      .orderBy('feedback.recorded_at', 'asc')
      .orderBy('feedback.id', 'asc')
      .execute();
    expect(feedbackTrail).toEqual([
      { candidate_id: harvestId, feedback_kind: 'completed', postponed_until: null },
      { candidate_id: reminderId, feedback_kind: 'postponed', postponed_until: horizon },
      { candidate_id: resurfacedId, feedback_kind: 'dismissed', postponed_until: null },
      { candidate_id: resurfacedId, feedback_kind: 'irrelevant', postponed_until: null },
    ]);
  });
});
