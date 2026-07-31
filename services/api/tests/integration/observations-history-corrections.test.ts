/**
 * Full-stack integration tests for `CorrectObservation` against real
 * PostgreSQL/PostGIS. Split out of `observations-history.test.ts` for the
 * same 600-line reason `plants-inventory-photos.test.ts` was split out of
 * `plants-inventory-photos-identification.test.ts` (see that file's own doc
 * comment); `RecordObservation` coverage stays in the sibling file.
 *
 * Source: implementation-plan.md work package P4-DATA-02;
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
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import {
  CorrectObservation,
  type CorrectObservationInput,
} from '../../src/modules/observations-history/application/correct-observation.js';
import { ListObservationsForGarden } from '../../src/modules/observations-history/application/list-observations-for-garden.js';
import {
  RecordObservation,
  type RecordObservationInput,
} from '../../src/modules/observations-history/application/record-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { KyselyObservationsHistoryUnitOfWork } from '../../src/modules/observations-history/persistence/kysely-observations-history-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { disabledPlantAiCallPolicies } from '../support/plant-ai-integration-test-doubles.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'observations-history corrections integration';
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
      listObservationsForGarden: new ListObservationsForGarden(observations, authorization),
    };
  }

  it('corrects an observation with an amendment, leaving the original row in the database completely unchanged', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const laterNow = new Date('2026-07-22T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const original = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      generateUuidV7(),
    );

    const originalRowBefore = await db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();

    const laterHandlers = buildHandlers(fixedClock(laterNow));
    const correctionInput: CorrectObservationInput = {
      correctionKind: 'amendment',
      noteText: 'Leaves recovered after watering.',
      conditionSummary: null,
      photos: [],
      measurements: [],
      observedPhenologicalStage: null,
    };
    const correction = await laterHandlers.correctObservation.execute(
      original.id,
      ownerId,
      correctionInput,
      generateUuidV7(),
    );

    expect(correction).toMatchObject({
      gardenId,
      correctionKind: 'amendment',
      correctsObservationId: original.id,
      noteText: 'Leaves recovered after watering.',
    });

    const originalRowAfter = await db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();
    expect(originalRowAfter).toEqual(originalRowBefore);

    // A correction is its own separate sync_change insert, at the new row's
    // own recordId, never an update to the original observation's row —
    // matching "the original row in the database completely unchanged"
    // this test's own title already asserts for the observation row itself.
    const originalSyncChange = await db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('record_id', '=', original.id)
      .where('record_type', '=', 'observation')
      .execute();
    expect(originalSyncChange).toHaveLength(1);

    const correctionSyncChange = await db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('record_id', '=', correction.id)
      .where('record_type', '=', 'observation')
      .executeTakeFirst();
    expect(correctionSyncChange).toMatchObject({
      garden_id: gardenId,
      operation: 'upsert',
      record_revision: 1,
    });
  });

  it('corrects an observation with a supersede, and the original now reports as corrected while the correction itself does not', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const original = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      generateUuidV7(),
    );

    const correctionInput: CorrectObservationInput = {
      correctionKind: 'supersede',
      noteText: 'This was actually a different plant.',
      conditionSummary: null,
      photos: [],
      measurements: [],
      observedPhenologicalStage: null,
    };
    const correction = await handlers.correctObservation.execute(
      original.id,
      ownerId,
      correctionInput,
      generateUuidV7(),
    );

    const history = await handlers.listObservationsForGarden.execute(gardenId, ownerId);
    const originalEntry = history.find((entry) => entry.id === original.id);
    const correctionEntry = history.find((entry) => entry.id === correction.id);
    expect(originalEntry?.isCorrected).toBe(true);
    expect(correctionEntry?.isCorrected).toBe(false);
  });

  it('rejects correcting an observation that does not exist', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const correctionInput: CorrectObservationInput = {
      correctionKind: 'amendment',
      noteText: 'Note.',
      conditionSummary: null,
      photos: [],
      measurements: [],
      observedPhenologicalStage: null,
    };
    await expect(
      handlers.correctObservation.execute(
        generateUuidV7(),
        ownerId,
        correctionInput,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
