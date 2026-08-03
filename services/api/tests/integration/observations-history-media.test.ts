/**
 * Full-stack integration tests for observations-history's P11-MEDIA-01
 * additions — typed measurements and the garden-context snapshot — against
 * real PostgreSQL/PostGIS. Split out of `observations-history.test.ts` for
 * the same 600-line reason `plants-inventory-photos.test.ts` was split out
 * of `plants-inventory-photos-identification.test.ts` (see that file's own
 * doc comment); purpose-labeled photo attachment is covered inline in
 * `observations-history.test.ts` itself since it only needed small edits to
 * existing tests there.
 *
 * Source: implementation-plan.md work package P11-MEDIA-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { RecordGardenContextFact } from '../../src/modules/gardens-mapping/application/record-garden-context-fact.js';
import { KyselyGardenContextFactRepository } from '../../src/modules/gardens-mapping/persistence/kysely-garden-context-fact-repository.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { CorrectObservation } from '../../src/modules/observations-history/application/correct-observation.js';
import {
  RecordObservation,
  type RecordObservationInput,
} from '../../src/modules/observations-history/application/record-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { KyselyObservationsHistoryUnitOfWork } from '../../src/modules/observations-history/persistence/kysely-observations-history-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { disabledPlantAiCallPolicies } from '../support/plant-ai-integration-test-doubles.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'observations-history media (P11-MEDIA-01) integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

const BASE_INPUT: RecordObservationInput = {
  plantId: null,
  gardenObjectId: null,
  noteText: 'Leaves look healthy.',
  conditionSummary: null,
  observedAt: null,
  photos: [],
  measurements: [],
  symptoms: [],
  observedPhenologicalStage: null,
};

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  async function createGardenWithOwner(now: Date): Promise<{ ownerId: string; gardenId: string }> {
    const ownerId = generateUuidV7();
    await insertProfile(ownerId);

    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyObservationsHistoryUnitOfWork(db, clock);
    const observations = new KyselyObservationRepository(db);
    const { analyzePlantCondition } = disabledPlantAiCallPolicies(db, clock);
    return {
      recordObservation: new RecordObservation(
        idempotency,
        unitOfWork,
        authorization,
        clock,
        analyzePlantCondition,
      ),
      correctObservation: new CorrectObservation(
        idempotency,
        unitOfWork,
        authorization,
        observations,
        clock,
        analyzePlantCondition,
      ),
    };
  }

  it('records typed measurements, allowing a second observation to reuse the same kind', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      {
        ...BASE_INPUT,
        measurements: [
          { kind: 'height', value: 30, unit: 'cm' },
          { kind: 'count', value: 4, unit: 'count' },
        ],
      },
      generateUuidV7(),
    );

    expect(resource.measurements).toHaveLength(2);
    const rows = await db
      .selectFrom('observations_history.observation_measurement')
      .selectAll()
      .where('observation_id', '=', resource.id)
      .execute();
    expect(rows).toHaveLength(2);

    // A second, later observation is free to record its own `height` row —
    // the uniqueness constraint is per observation, not per garden or plant.
    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, measurements: [{ kind: 'height', value: 5, unit: 'cm' }] },
        generateUuidV7(),
      ),
    ).resolves.toBeDefined();
  });

  it("snapshots the garden's currently declared sun exposure/drainage/growing context onto a new observation, and re-resolves it fresh for a later correction", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const laterNow = new Date('2026-07-22T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const recordContextFact = new RecordGardenContextFact(
      authorization,
      new KyselyGardenContextFactRepository(db),
      fixedClock(now),
    );
    await recordContextFact.execute(gardenId, ownerId, {
      contextKind: 'sun_exposure',
      value: 'full_sun',
      source: 'user_declared',
    });

    const handlers = buildHandlers(fixedClock(now));
    const observation = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, observedPhenologicalStage: 'flowering' },
      generateUuidV7(),
    );

    expect(observation.observedPhenologicalStage).toBe('flowering');
    expect(observation.observedSunExposure).toBe('full_sun');
    expect(observation.observedDrainage).toBeNull();
    expect(observation.observedGrowingContext).toBeNull();

    // Garden context changes before the correction is recorded — the
    // correction must reflect the NEW value, not copy the original's.
    await recordContextFact.execute(gardenId, ownerId, {
      contextKind: 'sun_exposure',
      value: 'partial_shade',
      source: 'user_declared',
    });
    const laterHandlers = buildHandlers(fixedClock(laterNow));
    const correction = await laterHandlers.correctObservation.execute(
      observation.id,
      ownerId,
      {
        correctionKind: 'amendment',
        noteText: 'Conditions changed.',
        conditionSummary: null,
        photos: [],
        measurements: [],
        symptoms: [],
        observedPhenologicalStage: null,
      },
      generateUuidV7(),
    );

    expect(correction.observedSunExposure).toBe('partial_shade');
  });
});
