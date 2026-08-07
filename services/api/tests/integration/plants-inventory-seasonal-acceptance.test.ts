/**
 * Full-stack integration tests for PER-GARDEN seasonal-timing acceptance
 * against real PostgreSQL.
 *
 * WHAT THIS PROVES, and why it needs a real database: the gate is an inner
 * join, not application code. A fact nobody accepted is invisible; a fact
 * ANOTHER garden accepted is invisible; accepting twice is one decision; and
 * a northern fact cannot be accepted as southern timing. The cross-garden
 * case is the one the whole per-garden design exists for — without it,
 * scoping the decision would be bookkeeping rather than a boundary.
 *
 * Split from `plants-inventory-seasonal-and-occupancy.test.ts` for the
 * 600-line reason that file is itself split from `plants-inventory.test.ts`.
 *
 * Source: migrations/1789700000000_garden-seasonal-fact-acceptance.sql;
 *         modules/plants-inventory/application/accept-garden-seasonal-facts.ts.
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
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyTaxonomySeasonalFactRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-seasonal-fact-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plants-inventory per-garden seasonal acceptance integration';
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
  }, 120_000);

  afterAll(async () => {
    // Only `destroy()`: Kysely ends the pool it was given, so calling
    // `pool.end()` as well throws "Called end on pool more than once".
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  async function createGardenWithOwner(now: Date) {
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

  async function insertTaxonomyReference(scientificName: string): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: scientificName,
        common_name: null,
        variety_name: null,
        family: null,
        genus: null,
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();
    return id;
  }

  describe('per-garden acceptance gate', () => {
    it("hides a fact until THIS garden accepts it, and never leaks another garden's decision", async () => {
      const taxonomyId = await insertTaxonomyReference('Daucus carota');

      await db
        .insertInto('plants_inventory.taxonomy_seasonal_fact')
        .values({
          id: randomUUID(),
          taxonomy_reference_id: taxonomyId,
          hemisphere: 'northern',
          sow_outdoors_start_month: 3,
          sow_outdoors_end_month: 5,
          days_to_maturity_min: 60,
          days_to_maturity_max: 80,
          authoring_method: 'ai_extracted_from_source',
          source_citation: 'USDA Plant Characteristics, accessed 2026-03-01',
          review_status: 'horticulturally_reviewed',
          reviewed_by: 'Dr. Amara Osei',
          reviewed_on: '2026-03-15',
        })
        .execute();

      // Same taxon, the OTHER hemisphere, deliberately still unreviewed —
      // "ship honestly unreviewed", the same precedent every launch rule's
      // own review metadata already sets.
      await db
        .insertInto('plants_inventory.taxonomy_seasonal_fact')
        .values({
          id: randomUUID(),
          taxonomy_reference_id: taxonomyId,
          hemisphere: 'southern',
          sow_outdoors_start_month: 9,
          sow_outdoors_end_month: 11,
          authoring_method: 'human_authored',
          review_status: 'awaiting_horticultural_review',
        })
        .execute();

      const repository = new KyselyTaxonomySeasonalFactRepository(db);
      const northernFactId = await db
        .selectFrom('plants_inventory.taxonomy_seasonal_fact')
        .select('id')
        .where('taxonomy_reference_id', '=', taxonomyId)
        .where('hemisphere', '=', 'northern')
        .executeTakeFirstOrThrow();

      const { ownerId, gardenId } = await createGardenWithOwner(new Date('2026-04-01T00:00:00Z'));
      const { gardenId: otherGardenId } = await createGardenWithOwner(
        new Date('2026-04-01T00:00:00Z'),
      );

      // Before anyone accepts it, seeded content is invisible — the row's own
      // provenance and review columns do not grant a garden the right to use
      // it.
      await expect(
        repository.findAcceptedForGarden(gardenId, taxonomyId, 'northern'),
      ).resolves.toBeNull();

      await expect(
        repository.acceptForGarden({
          id: randomUUID(),
          gardenId,
          taxonomySeasonalFactId: northernFactId.id,
          acceptedByProfileId: ownerId,
          acceptedOn: '2026-04-01',
          hemisphere: 'northern',
        }),
      ).resolves.toBe(true);

      const accepted = await repository.findAcceptedForGarden(gardenId, taxonomyId, 'northern');
      expect(accepted).toMatchObject({
        taxonomyReferenceId: taxonomyId,
        hemisphere: 'northern',
        sowOutdoorsStartMonth: 3,
        sowOutdoorsEndMonth: 5,
        daysToMaturityMin: 60,
        daysToMaturityMax: 80,
        authoringMethod: 'ai_extracted_from_source',
        sourceCitation: 'USDA Plant Characteristics, accessed 2026-03-01',
      });

      // THE PROPERTY THE PER-GARDEN DESIGN EXISTS FOR: one garden's decision
      // does not reach another's. Without this, scoping the acceptance would
      // be bookkeeping rather than a boundary.
      await expect(
        repository.findAcceptedForGarden(otherGardenId, taxonomyId, 'northern'),
      ).resolves.toBeNull();

      // Accepting again is the same single decision, not an error.
      await expect(
        repository.acceptForGarden({
          id: randomUUID(),
          gardenId,
          taxonomySeasonalFactId: northernFactId.id,
          acceptedByProfileId: ownerId,
          acceptedOn: '2026-04-02',
          hemisphere: 'northern',
        }),
      ).resolves.toBe(true);

      // A northern fact cannot be accepted as southern timing: the months
      // would be inverted for the accepting garden.
      await expect(
        repository.acceptForGarden({
          id: randomUUID(),
          gardenId: otherGardenId,
          taxonomySeasonalFactId: northernFactId.id,
          acceptedByProfileId: ownerId,
          acceptedOn: '2026-04-01',
          hemisphere: 'southern',
        }),
      ).resolves.toBe(false);
    });
  });
});
