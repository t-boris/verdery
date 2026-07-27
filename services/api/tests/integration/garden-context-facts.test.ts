/**
 * Full-stack integration tests for garden context facts (P9D-CONTEXT-01)
 * against real PostgreSQL: the real `GardenAuthorization`, the real
 * `KyselyGardenContextFactRepository`, and the real migrated schema — not
 * fakes. Proves the upsert-in-place semantics and the authorization matrix
 * `RecordGardenContextFact`/`ListGardenContextFacts` enforce.
 *
 * Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01
 * ("Context provenance tests").
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
// `reviewed_on` is a `date` column — see `pg-date-parser.ts`'s own header
// for why this side-effect import is required for it to read back as the
// raw `'YYYY-MM-DD'` string `GardenContextFact.reviewedOn`'s type promises,
// not a timezone-sensitive JS `Date`.
import '../../src/platform/database/pg-date-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { ListGardenContextFacts } from '../../src/modules/gardens-mapping/application/list-garden-context-facts.js';
import { RecordGardenContextFact } from '../../src/modules/gardens-mapping/application/record-garden-context-fact.js';
import { KyselyGardenContextFactRepository } from '../../src/modules/gardens-mapping/persistence/kysely-garden-context-fact-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'garden context facts integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
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
  });

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

  async function insertGarden(id: string, ownerProfileId: string): Promise<void> {
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id,
        name: 'Test Garden',
        lifecycle_state: 'active',
        created_by_profile_id: ownerProfileId,
      })
      .execute();
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: id,
        profile_id: ownerProfileId,
        role: 'owner',
        state: 'active',
      })
      .execute();
  }

  async function insertMember(
    gardenId: string,
    profileId: string,
    role: 'editor' | 'viewer',
  ): Promise<void> {
    await insertProfile(profileId);
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        profile_id: profileId,
        role,
        state: 'active',
      })
      .execute();
  }

  function buildCommands(now: Date) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const repository = new KyselyGardenContextFactRepository(db);
    return {
      record: new RecordGardenContextFact(authorization, repository, fixedClock(now)),
      list: new ListGardenContextFacts(authorization, repository),
    };
  }

  it('records a new fact at revision 1, then updates the SAME row in place on a second call — no second row', async () => {
    const ownerId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertGarden(gardenId, ownerId);

    const { record, list } = buildCommands(new Date('2026-07-21T09:00:00Z'));

    const first = await record.execute(gardenId, ownerId, {
      contextKind: 'sun_exposure',
      value: 'full_sun',
      source: 'user_declared',
    });
    expect(first).toMatchObject({
      gardenId,
      contextKind: 'sun_exposure',
      value: 'full_sun',
      revision: 1,
    });

    const second = await record.execute(gardenId, ownerId, {
      contextKind: 'sun_exposure',
      value: 'partial_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
    });
    expect(second).toMatchObject({
      id: first.id,
      gardenId,
      contextKind: 'sun_exposure',
      value: 'partial_sun',
      source: 'horticulturally_reviewed_default',
      reviewedBy: 'Dr. Amara Osei',
      reviewedOn: '2026-03-15',
      revision: 2,
    });

    const rows = await db
      .selectFrom('gardens_mapping.garden_context_fact')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);

    const facts = await list.execute(gardenId, ownerId);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      contextKind: 'sun_exposure',
      value: 'partial_sun',
      revision: 2,
    });
  });

  it('records independent facts for different contextKinds on the same garden without colliding', async () => {
    const ownerId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertGarden(gardenId, ownerId);

    const { record, list } = buildCommands(new Date('2026-07-21T09:00:00Z'));

    await record.execute(gardenId, ownerId, {
      contextKind: 'drainage',
      value: 'well_drained',
      source: 'user_declared',
    });
    await record.execute(gardenId, ownerId, {
      contextKind: 'irrigation_method',
      value: 'drip',
      source: 'imported',
    });

    const facts = await list.execute(gardenId, ownerId);
    expect(facts.map((fact) => fact.contextKind).sort()).toEqual(['drainage', 'irrigation_method']);
  });

  it('rejects recording without editGardenContent capability (viewer), with ForbiddenError', async () => {
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertGarden(gardenId, ownerId);
    await insertMember(gardenId, viewerId, 'viewer');

    const { record } = buildCommands(new Date());

    await expect(
      record.execute(gardenId, viewerId, {
        contextKind: 'microclimate',
        value: 'Frost pocket in the low corner',
        source: 'user_declared',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows recording with editGardenContent capability (editor)', async () => {
    const ownerId = randomUUID();
    const editorId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertGarden(gardenId, ownerId);
    await insertMember(gardenId, editorId, 'editor');

    const { record } = buildCommands(new Date());

    const fact = await record.execute(gardenId, editorId, {
      contextKind: 'growing_context',
      value: 'greenhouse',
      source: 'user_declared',
    });
    expect(fact.value).toBe('greenhouse');
  });

  it('lets a viewer-only member list facts (viewGarden capability)', async () => {
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertGarden(gardenId, ownerId);
    await insertMember(gardenId, viewerId, 'viewer');

    const { record, list } = buildCommands(new Date());
    await record.execute(gardenId, ownerId, {
      contextKind: 'soil_type',
      value: 'Sandy loam',
      source: 'user_declared',
    });

    const facts = await list.execute(gardenId, viewerId);
    expect(facts).toHaveLength(1);
  });

  it('conceals a garden the caller has no membership on as NotFoundError for both record and list', async () => {
    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const gardenId = randomUUID();
    await insertProfile(ownerId);
    await insertProfile(strangerId);
    await insertGarden(gardenId, ownerId);

    const { record, list } = buildCommands(new Date());

    await expect(
      record.execute(gardenId, strangerId, {
        contextKind: 'soil_type',
        value: 'Clay',
        source: 'user_declared',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(list.execute(gardenId, strangerId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
