/**
 * Full-stack integration tests for P11-SEARCH-01's two newly-real search
 * surfaces against real PostgreSQL: `ListCandidates`'s trigram/relevance
 * search over `plant_candidate.display_name`, and `SearchTaxonomyReferences`'s
 * extended match against `taxonomy_name` (synonyms, cultivars, localized
 * common names) — not fakes. Mirrors the rigor of
 * `tests/integration/plants-inventory-search.test.ts`.
 *
 * Source: implementation-plan.md work package P11-SEARCH-01;
 * migrations/1787800000000_plant-search-extensions.sql.
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
import { ListCandidates } from '../../src/modules/plants-inventory/application/list-candidates.js';
import { SearchTaxonomyReferences } from '../../src/modules/plants-inventory/application/search-taxonomy-references.js';
import { KyselyPlantCandidateRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-candidate-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { KyselyTaxonomyReferenceRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-reference-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plant search extensions integration';
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

  function buildListCandidates() {
    return new ListCandidates(
      new KyselyPlantCandidateRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
    );
  }

  async function addCandidate(
    gardenId: string,
    ownerId: string,
    clock: Clock,
    displayName: string,
  ): Promise<string> {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const addCandidateCommand = new AddCandidate(
      new KyselyIdempotencyStore(db, clock),
      new KyselyPlantsInventoryUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const candidate = await addCandidateCommand.execute(
      gardenId,
      ownerId,
      { displayName, groupingKind: 'individual' },
      generateUuidV7(),
    );
    return candidate.id;
  }

  it('matches candidate displayName by trigram similarity, tolerating a misspelling ILIKE would miss', async () => {
    const now = new Date('2026-07-31T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const clock = fixedClock(now);
    const figId = await addCandidate(gardenId, ownerId, clock, 'Fig Tree');
    await addCandidate(gardenId, ownerId, clock, 'Basil');

    const result = await buildListCandidates().execute(
      gardenId,
      ownerId,
      { query: 'fyg tree' },
      null,
      50,
    );

    expect(result.items.map((item) => item.id)).toEqual([figId]);
  });

  it('filters candidates by priority and identified state', async () => {
    const now = new Date('2026-07-31T10:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const clock = fixedClock(now);
    const taxonomyReferenceId = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ficus carica',
        source: 'system_catalog',
      })
      .execute();

    const highPriorityId = await addCandidate(gardenId, ownerId, clock, 'Fig Tree');
    await db
      .updateTable('plants_inventory.plant_candidate')
      .set({ priority: 'high', taxonomy_reference_id: taxonomyReferenceId })
      .where('id', '=', highPriorityId)
      .execute();
    await addCandidate(gardenId, ownerId, clock, 'Mystery Seedling');

    const listCandidates = buildListCandidates();

    const byPriority = await listCandidates.execute(
      gardenId,
      ownerId,
      { priority: ['high'] },
      null,
      50,
    );
    expect(byPriority.items.map((item) => item.id)).toEqual([highPriorityId]);

    const identified = await listCandidates.execute(
      gardenId,
      ownerId,
      { identified: true },
      null,
      50,
    );
    expect(identified.items.map((item) => item.id)).toEqual([highPriorityId]);
  });

  it('matches a synonym, a cultivar, and a localized common name — never returning the same taxon twice', async () => {
    const taxonomyReferenceId = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ficus carica',
        common_name: 'Common fig',
        source: 'system_catalog',
      })
      .execute();
    await db
      .insertInto('plants_inventory.taxonomy_name')
      .values([
        {
          id: generateUuidV7(),
          taxonomy_reference_id: taxonomyReferenceId,
          name_kind: 'synonym_scientific',
          name_text: 'Ficus carica var. hortensis',
          source: 'system_catalog',
        },
        {
          id: generateUuidV7(),
          taxonomy_reference_id: taxonomyReferenceId,
          name_kind: 'cultivar',
          name_text: 'Brown Turkey',
          source: 'system_catalog',
        },
        {
          id: generateUuidV7(),
          taxonomy_reference_id: taxonomyReferenceId,
          name_kind: 'common',
          locale: 'fr',
          name_text: 'Figuier commun',
          source: 'system_catalog',
        },
      ])
      .execute();

    const searchTaxonomyReferences = new SearchTaxonomyReferences(
      new KyselyTaxonomyReferenceRepository(db),
    );

    const bySynonym = await searchTaxonomyReferences.execute('hortensis', 10);
    expect(bySynonym.map((r) => r.id)).toEqual([taxonomyReferenceId]);
    expect(bySynonym[0]?.matchedName).toEqual({
      nameKind: 'synonym_scientific',
      nameText: 'Ficus carica var. hortensis',
      locale: null,
    });

    const byCultivar = await searchTaxonomyReferences.execute('brown turkey', 10);
    expect(byCultivar.map((r) => r.id)).toEqual([taxonomyReferenceId]);
    expect(byCultivar[0]?.matchedName).toMatchObject({
      nameKind: 'cultivar',
      nameText: 'Brown Turkey',
    });

    const byLocalizedCommonName = await searchTaxonomyReferences.execute('figuier commun', 10);
    expect(byLocalizedCommonName.map((r) => r.id)).toEqual([taxonomyReferenceId]);
    expect(byLocalizedCommonName[0]?.matchedName).toEqual({
      nameKind: 'common',
      nameText: 'Figuier commun',
      locale: 'fr',
    });

    // The taxon's OWN scientificName/commonName still win when they are the
    // best match — the reference row appears exactly once either way.
    const byOwnCommonName = await searchTaxonomyReferences.execute('common fig', 10);
    expect(byOwnCommonName.map((r) => r.id)).toEqual([taxonomyReferenceId]);
    expect(byOwnCommonName[0]?.matchedName).toEqual({
      nameKind: 'common',
      nameText: 'Common fig',
      locale: null,
    });
  });
});
