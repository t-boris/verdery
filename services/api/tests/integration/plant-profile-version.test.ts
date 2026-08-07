/**
 * Full-stack integration test for P11-DATA-02's `RebuildPlantProfileVersion`
 * against real PostgreSQL/PostGIS: the real `KyselyPlantFactAssertionRepository`,
 * `KyselyPlantTaxonomyMappingRepository`, and `KyselyPlantProfileVersionRepository`
 * — the storage-to-domain-to-storage round trip `plant-profile-version.ts`'s
 * own header describes.
 *
 * Source: implementation-plan.md work package P11-DATA-02.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { createPlantFactAssertion } from '../../src/modules/integrations/domain/plant-fact-assertion.js';
import { KyselyPlantFactAssertionRepository } from '../../src/modules/integrations/persistence/kysely-plant-fact-assertion-repository.js';
import { KyselyPlantTaxonomyMappingRepository } from '../../src/modules/integrations/persistence/kysely-plant-taxonomy-mapping-repository.js';
import { RebuildPlantProfileVersion } from '../../src/modules/plants-inventory/application/rebuild-plant-profile-version.js';
import { KyselyPlantProfileVersionRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-profile-version-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plant profile version integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-29T12:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let taxonomyReferenceId: string;

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

  async function freshTaxon(): Promise<void> {
    taxonomyReferenceId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ficus carica',
        source: 'system_catalog',
      })
      .execute();
  }

  async function seedLiveMapping(providerKey: string, providerTaxonId: string): Promise<void> {
    await db
      .insertInto('integrations.plant_taxonomy_mapping')
      .values({
        id: randomUUID(),
        taxonomy_reference_id: taxonomyReferenceId,
        provider_key: providerKey,
        provider_taxon_id: providerTaxonId,
      })
      .execute();
  }

  function buildHandlers() {
    const mappings = new KyselyPlantTaxonomyMappingRepository(db);
    const facts = new KyselyPlantFactAssertionRepository(db);
    const profileVersions = new KyselyPlantProfileVersionRepository(db);
    const rebuild = new RebuildPlantProfileVersion(mappings, facts, profileVersions, randomUUID, {
      now: () => NOW,
    });
    return { mappings, facts, profileVersions, rebuild };
  }

  it('rebuilds a real profile version from reviewed fact assertions across two providers', async () => {
    await freshTaxon();
    await seedLiveMapping('usda-plants', 'PROV-USDA-1');
    await seedLiveMapping('wikidata', 'PROV-WD-1');
    const { facts, profileVersions, rebuild } = buildHandlers();

    await facts.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: 'PROV-USDA-1',
        rawFactKey: 'hardinessZoneMin',
        factValue: 6,
        unit: null,
        confidence: 0.9,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'usda-plants',
          sourceCitation: 'USDA PLANTS, accessed 2026-07-29',
        },
        review: {
          reviewStatus: 'horticulturally_reviewed',
          reviewedBy: 'Dr. Amara Osei',
          reviewedOn: '2026-07-29',
        },
        fetchedAt: NOW,
        now: NOW,
      }),
    );
    // A second, still-unreviewed cited source remains displayable, but the
    // horticulturally reviewed assertion wins the conflict.
    await facts.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: 'PROV-WD-1',
        rawFactKey: 'hardinessZoneMin',
        factValue: 5,
        unit: null,
        confidence: 0.5,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'wikidata',
          sourceCitation: 'Wikidata, accessed 2026-07-29',
        },
        review: { reviewStatus: 'awaiting_horticultural_review' },
        fetchedAt: NOW,
        now: NOW,
      }),
    );

    const result = await rebuild.execute(taxonomyReferenceId, ['usda-plants', 'wikidata']);

    expect(result.outcome).toBe('rebuilt');
    if (result.outcome !== 'rebuilt') {
      throw new Error('expected rebuilt');
    }
    expect(result.version.resolvedFacts).toEqual([
      {
        factKey: 'hardinessZoneMin',
        value: 6,
        unit: null,
        geographicScope: null,
        providerKey: 'usda-plants',
        confidence: 0.9,
        sourceCitation: 'USDA PLANTS, accessed 2026-07-29',
        evidenceStatus: 'horticulturally_reviewed',
      },
    ]);
    expect(result.version.isPartial).toBe(false);

    const stored = await profileVersions.findLatest(taxonomyReferenceId);
    expect(stored).toEqual(result.version);
  });

  it('includes human-authored facts even with no provider mapping at all', async () => {
    await freshTaxon();
    const { facts, rebuild } = buildHandlers();

    await facts.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: taxonomyReferenceId,
        rawFactKey: 'toxicity',
        factValue: 'sap may irritate skin',
        unit: null,
        confidence: null,
        geographicScope: null,
        authoring: { authoringMethod: 'human_authored', providerKey: 'human' },
        review: {
          reviewStatus: 'horticulturally_reviewed',
          reviewedBy: 'Dr. Amara Osei',
          reviewedOn: '2026-07-29',
        },
        fetchedAt: null,
        now: NOW,
      }),
    );

    const result = await rebuild.execute(taxonomyReferenceId, ['usda-plants']);
    expect(result.outcome).toBe('rebuilt');
    if (result.outcome !== 'rebuilt') {
      throw new Error('expected rebuilt');
    }
    expect(result.version.resolvedFacts[0]).toMatchObject({
      factKey: 'toxicity',
      providerKey: 'human',
    });
  });

  it('materializes a cited provider fact as source-backed before horticultural review', async () => {
    await freshTaxon();
    await seedLiveMapping('usda-plants', 'PROV-USDA-2');
    const { facts, rebuild } = buildHandlers();

    await facts.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: 'PROV-USDA-2',
        rawFactKey: 'hardinessZoneMin',
        factValue: 6,
        unit: null,
        confidence: null,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'usda-plants',
          sourceCitation: 'USDA PLANTS',
        },
        review: { reviewStatus: 'awaiting_horticultural_review' },
        fetchedAt: NOW,
        now: NOW,
      }),
    );

    const result = await rebuild.execute(taxonomyReferenceId, ['usda-plants']);
    expect(result.outcome).toBe('rebuilt');
    if (result.outcome !== 'rebuilt') {
      throw new Error('expected rebuilt');
    }
    expect(result.version.resolvedFacts).toEqual([
      expect.objectContaining({
        factKey: 'hardinessZoneMin',
        providerKey: 'usda-plants',
        evidenceStatus: 'source_backed',
      }),
    ]);
  });

  it('skips a provider with no live mapping for this taxon entirely', async () => {
    await freshTaxon();
    const { rebuild } = buildHandlers();

    const result = await rebuild.execute(taxonomyReferenceId, ['usda-plants', 'wikidata']);
    expect(result).toEqual({ outcome: 'nothingToResolve' });
  });
});
