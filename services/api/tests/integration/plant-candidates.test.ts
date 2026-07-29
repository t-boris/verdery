/**
 * Full-stack integration tests for P11-DATA-01's candidate schema and
 * conversion against real PostgreSQL/PostGIS: real repositories, the real
 * transactional unit of work — not fakes. Mirrors the rigor of
 * `tests/integration/plants-inventory.test.ts`.
 *
 * Covers `AddCandidate`, `UpdateCandidateDetails`, `SetCandidateStatus`, and
 * `ConvertCandidate`'s at-most-once-per-candidate guarantee under a genuine
 * concurrent race — the one property the unit tests (non-transactional
 * fakes) cannot exercise for real.
 *
 * Source: implementation-plan.md work package P11-DATA-01;
 *         migrations/1787600000000_plant-candidates-and-conversion.sql.
 */

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
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { AddCandidate } from '../../src/modules/plants-inventory/application/add-candidate.js';
import { ConvertCandidate } from '../../src/modules/plants-inventory/application/convert-candidate.js';
import { SetCandidateStatus } from '../../src/modules/plants-inventory/application/set-candidate-status.js';
import { UpdateCandidateDetails } from '../../src/modules/plants-inventory/application/update-candidate-details.js';
import { KyselyCandidateConversionRepository } from '../../src/modules/plants-inventory/persistence/kysely-candidate-conversion-repository.js';
import { KyselyPlantCandidateRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-candidate-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { DomainRuleViolatedError } from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plant candidates and conversion integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

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

  async function createGardenWithOwner(now: Date) {
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);

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
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const candidateRepository = new KyselyPlantCandidateRepository(db);
    const conversionRepository = new KyselyCandidateConversionRepository(db);

    return {
      candidateRepository,
      conversionRepository,
      addCandidate: new AddCandidate(idempotency, unitOfWork, authorization, clock),
      updateCandidateDetails: new UpdateCandidateDetails(
        candidateRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      setCandidateStatus: new SetCandidateStatus(
        candidateRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      convertCandidate: new ConvertCandidate(
        candidateRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
    };
  }

  it('creates a candidate, updates it, and reads it back with a real revision', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const candidate = await handlers.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual', priority: 'medium' },
      generateUuidV7(),
    );
    expect(candidate.status).toBe('active');

    const updated = await handlers.updateCandidateDetails.execute(
      candidate.id,
      ownerId,
      candidate.revision,
      { rationaleNote: 'Would fill the shady corner nicely' },
      generateUuidV7(),
    );
    expect(updated.rationaleNote).toBe('Would fill the shady corner nicely');
    expect(updated.revision).toBe(2);

    const reread = await handlers.candidateRepository.findById(candidate.id);
    expect(reread).toMatchObject({ rationaleNote: 'Would fill the shady corner nicely' });
  });

  it('archives a candidate via SetCandidateStatus', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const candidate = await handlers.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Maybe a lemon tree', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const archived = await handlers.setCandidateStatus.execute(
      candidate.id,
      ownerId,
      candidate.revision,
      'archived',
      generateUuidV7(),
    );
    expect(archived.status).toBe('archived');
  });

  it('converts a candidate into a real plant, preserving conversion history', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const candidate = await handlers.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const result = await handlers.convertCandidate.execute(
      candidate.id,
      ownerId,
      candidate.revision,
      { acquisitionDate: '2026-07-29', acquisitionDateType: 'planted' },
      generateUuidV7(),
    );

    expect(result.plant.gardenId).toBe(gardenId);
    expect(result.plant.displayName).toBe('Fig tree');
    expect(result.candidate.status).toBe('converted');

    const rereadCandidate = await handlers.candidateRepository.findById(candidate.id);
    expect(rereadCandidate?.status).toBe('converted');

    const conversion = await handlers.conversionRepository.findByCandidateId(candidate.id);
    expect(conversion).toMatchObject({ candidateId: candidate.id, plantId: result.plant.id });
  });

  it('refuses a second conversion of an already-converted candidate', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const candidate = await handlers.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual' },
      generateUuidV7(),
    );
    await handlers.convertCandidate.execute(
      candidate.id,
      ownerId,
      candidate.revision,
      {},
      generateUuidV7(),
    );

    await expect(
      handlers.convertCandidate.execute(
        candidate.id,
        ownerId,
        candidate.revision,
        {},
        generateUuidV7(),
      ),
    ).rejects.toThrow();
  });

  it('under a genuine concurrent race, exactly one of two simultaneous conversions succeeds', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlersA = buildHandlers(fixedClock(now));
    const handlersB = buildHandlers(fixedClock(now));

    const candidate = await handlersA.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const outcomes = await Promise.allSettled([
      handlersA.convertCandidate.execute(
        candidate.id,
        ownerId,
        candidate.revision,
        {},
        generateUuidV7(),
      ),
      handlersB.convertCandidate.execute(
        candidate.id,
        ownerId,
        candidate.revision,
        {},
        generateUuidV7(),
      ),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const conversion = await handlersA.conversionRepository.findByCandidateId(candidate.id);
    expect(conversion).not.toBeNull();
  });

  it('rejects converting a candidate that has already been archived', async () => {
    const now = new Date('2026-07-29T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const candidate = await handlers.addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual' },
      generateUuidV7(),
    );
    const archived = await handlers.setCandidateStatus.execute(
      candidate.id,
      ownerId,
      candidate.revision,
      'archived',
      generateUuidV7(),
    );

    await expect(
      handlers.convertCandidate.execute(
        candidate.id,
        ownerId,
        archived.revision,
        {},
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });
});
