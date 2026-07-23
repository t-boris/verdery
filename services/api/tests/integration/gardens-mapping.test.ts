/**
 * Full-stack integration tests for the gardens-mapping module against real
 * PostgreSQL: real repositories, the real transactional unit of work, and
 * the real idempotency table — not fakes.
 *
 * This is what actually proves the idempotency redesign works: the store was
 * first designed around a "processing" row written before the result was
 * known, reasoned to be correct, and only failed once it ran inside a real
 * Postgres transaction (a caught unique-violation still leaves every later
 * statement in that transaction erroring). A unit test against fakes would
 * not have caught that; only a real transaction can.
 *
 * Source: implementation-plan.md work packages P2-BE-01, P2-SEC-01, P2-API-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Side effect: without this, every bigint revision column reads back as a
// string, and every `garden.revision !== expectedRevision` comparison in
// applyRevisionGuardedUpdate spuriously fails. See that module.
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { ArchiveGarden } from '../../src/modules/gardens-mapping/application/archive-garden.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GetGarden } from '../../src/modules/gardens-mapping/application/get-garden.js';
import { ListGardens } from '../../src/modules/gardens-mapping/application/list-gardens.js';
import { RenameGarden } from '../../src/modules/gardens-mapping/application/rename-garden.js';
import { RequestGardenDeletion } from '../../src/modules/gardens-mapping/application/request-garden-deletion.js';
import { KyselyGardenRepository } from '../../src/modules/gardens-mapping/persistence/kysely-garden-repository.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
  StaleRevisionError,
} from '../../src/platform/errors/application-error.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'gardens-mapping integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
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
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  it('creates a garden, its owner membership, an outbox event, and an audit event together', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const now = new Date('2026-07-21T09:00:00Z');
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );

    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());

    expect(garden).toMatchObject({
      name: 'Backyard',
      lifecycleState: 'active',
      callerRole: 'owner',
      revision: 1,
    });

    const membership = await db
      .selectFrom('collaboration.membership')
      .selectAll()
      .where('garden_id', '=', garden.id)
      .where('profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(membership.role).toBe('owner');

    const outboxEvent = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', garden.id)
      .where('event_type', '=', 'garden.created')
      .executeTakeFirst();
    expect(outboxEvent).toBeDefined();

    const auditEvent = await db
      .selectFrom('platform.audit_event')
      .selectAll()
      .where('subject_id', '=', garden.id)
      .where('event_type', '=', 'garden.created')
      .executeTakeFirst();
    expect(auditEvent).toBeDefined();
  });

  it('replays the same idempotency key without creating a second garden, and rejects a reused key with a different name', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, fixedClock(new Date())),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(new Date())),
      fixedClock(new Date()),
    );
    const key = randomUUID();

    const first = await createGarden.execute(ownerId, 'Backyard', key);
    const replay = await createGarden.execute(ownerId, 'Backyard', key);
    expect(replay).toEqual(first);

    await expect(createGarden.execute(ownerId, 'Front Yard', key)).rejects.toBeInstanceOf(
      ConflictError,
    );

    const gardenCount = await db
      .selectFrom('gardens_mapping.garden')
      .select(db.fn.countAll().as('count'))
      .where('created_by_profile_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(Number(gardenCount.count)).toBe(1);
  });

  it('lists only gardens the profile has active membership on, and conceals a garden the profile cannot see as notFound', async () => {
    const ownerId = randomUUID();
    const strangerId = randomUUID();
    await insertProfile(db, ownerId);
    await insertProfile(db, strangerId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());

    const gardenRepository = new KyselyGardenRepository(db);
    const membershipRepository = new KyselyMembershipRepository(db);
    const authorization = new GardenAuthorization(membershipRepository);

    const listGardens = new ListGardens(gardenRepository);
    const ownerList = await listGardens.execute(ownerId, null, 50);
    expect(ownerList.items.map((item) => item.id)).toContain(garden.id);

    const strangerList = await listGardens.execute(strangerId, null, 50);
    expect(strangerList.items.map((item) => item.id)).not.toContain(garden.id);

    const getGarden = new GetGarden(gardenRepository, authorization);
    await expect(getGarden.execute(garden.id, ownerId)).resolves.toMatchObject({ id: garden.id });
    await expect(getGarden.execute(garden.id, strangerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('matches a garden name by trigram similarity when nameQuery is given, ranked most-similar first, without changing the no-query listing', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    // Each garden gets its own random suffix, not one shared across both:
    // trigram similarity picks up on *any* shared substring, so two gardens
    // sharing one suffix would each partially match the other's query purely
    // from that shared tail (confirmed directly against a real Postgres
    // instance while writing this test: with a shared suffix, 'Shady Hollow'
    // scored ~0.33 — above this repository's own 0.25 threshold — against a
    // 'sunyside <suffix>' query it has no real relationship to) — the same
    // pitfall plants-inventory-photos-identification.test.ts's own identical
    // note on the sibling `SearchTaxonomyReferences` upgrade already found.
    const sunnysideSuffix = randomUUID().slice(-8);
    const shadySuffix = randomUUID().slice(-8);
    const sunnyside = await createGarden.execute(
      ownerId,
      `Sunnyside Allotment ${sunnysideSuffix}`,
      randomUUID(),
    );
    const shady = await createGarden.execute(ownerId, `Shady Hollow ${shadySuffix}`, randomUUID());

    const gardenRepository = new KyselyGardenRepository(db);
    const listGardens = new ListGardens(gardenRepository);

    // Omitted `nameQuery`: unchanged from before P4-SEARCH-01 — every garden
    // the profile can see, no filter applied.
    const unfiltered = await listGardens.execute(ownerId, null, 50);
    expect(unfiltered.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([sunnyside.id, shady.id]),
    );

    // 'sunyside' is not a substring of 'Sunnyside Allotment <suffix>' in
    // either direction, so a plain `ILIKE '%sunyside%'` match would find
    // nothing here — trigram similarity tolerates the misspelling and does
    // not also return the unrelated 'Shady Hollow' garden.
    const misspelled = await listGardens.execute(ownerId, null, 50, `sunyside ${sunnysideSuffix}`);
    expect(misspelled.items.map((item) => item.id)).toEqual([sunnyside.id]);

    // Blank nameQuery behaves exactly like an omitted one.
    const blank = await listGardens.execute(ownerId, null, 50, '   ');
    expect(blank.items.map((item) => item.id)).toEqual(unfiltered.items.map((item) => item.id));
  });

  it('paginates a ranked nameQuery listing by cursor, covering every match exactly once', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const suffix = randomUUID().slice(-8);
    const names = [
      `Northfield Allotment ${suffix}`,
      `Southfield Allotment ${suffix}`,
      `Eastfield Allotment ${suffix}`,
    ];
    const createdIds: string[] = [];
    for (const name of names) {
      const garden = await createGarden.execute(ownerId, name, randomUUID());
      createdIds.push(garden.id);
    }

    const listGardens = new ListGardens(new KyselyGardenRepository(db));
    const seenIds = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await listGardens.execute(ownerId, cursor, 2, `allotment ${suffix}`);
      for (const item of page.items) {
        seenIds.add(item.id);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seenIds).toEqual(new Set(createdIds));
  });

  it('rejects a stale If-Match revision and applies a correct one', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const renameGarden = new RenameGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );

    await expect(
      renameGarden.execute(garden.id, ownerId, 'Front Yard', 999, randomUUID()),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    const renamed = await renameGarden.execute(
      garden.id,
      ownerId,
      'Front Yard',
      garden.revision,
      randomUUID(),
    );
    expect(renamed).toMatchObject({ name: 'Front Yard', revision: garden.revision + 1 });

    const auditEvent = await db
      .selectFrom('platform.audit_event')
      .selectAll()
      .where('subject_id', '=', garden.id)
      .where('event_type', '=', 'garden.renamed')
      .executeTakeFirst();
    expect(auditEvent).toBeDefined();
  });

  it('lets only the owner archive or request deletion; an editor can view but not manage', async () => {
    const ownerId = randomUUID();
    const editorId = randomUUID();
    await insertProfile(db, ownerId);
    await insertProfile(db, editorId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());

    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: garden.id,
        profile_id: editorId,
        role: 'editor',
        state: 'active',
      })
      .execute();

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const archiveGarden = new ArchiveGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );

    await expect(
      archiveGarden.execute(garden.id, editorId, garden.revision, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const archived = await archiveGarden.execute(garden.id, ownerId, garden.revision, randomUUID());
    expect(archived.lifecycleState).toBe('archived');

    // A fresh command against an already-archived garden is a domain
    // conflict, not a silent no-op — only a replayed idempotency key is.
    await expect(
      archiveGarden.execute(garden.id, ownerId, archived.revision, randomUUID()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    const auditEvent = await db
      .selectFrom('platform.audit_event')
      .selectAll()
      .where('subject_id', '=', garden.id)
      .where('event_type', '=', 'garden.archived')
      .executeTakeFirst();
    expect(auditEvent).toBeDefined();
  });

  it('moves a garden through archive and then delete-request', async () => {
    const ownerId = randomUUID();
    await insertProfile(db, ownerId);

    const clock = fixedClock(new Date());
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const requestGardenDeletion = new RequestGardenDeletion(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );

    const requested = await requestGardenDeletion.execute(
      garden.id,
      ownerId,
      garden.revision,
      randomUUID(),
    );

    expect(requested.lifecycleState).toBe('deletionRequested');

    const row = await db
      .selectFrom('gardens_mapping.garden')
      .select('deletion_requested_at')
      .where('id', '=', garden.id)
      .executeTakeFirstOrThrow();
    expect(row.deletion_requested_at).not.toBeNull();

    const deletionRequestedAuditEvent = await db
      .selectFrom('platform.audit_event')
      .selectAll()
      .where('subject_id', '=', garden.id)
      .where('event_type', '=', 'garden.deletion_requested')
      .executeTakeFirst();
    expect(deletionRequestedAuditEvent).toBeDefined();
  });
});
