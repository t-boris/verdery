/**
 * Full-stack integration test for P11-SUIT-01's `RecalculateCandidateSuitability`
 * against real PostgreSQL/PostGIS: real repositories, real garden-context
 * facts, a real assembled `PlantProfileVersion`, and real distribution
 * assertions — the storage-to-domain-to-storage round trip the fixture
 * suite (`tests/suitability-fixtures/`) cannot reach, since it starts from
 * an already-assembled `GardenSuitabilityFacts`/`CandidateSuitabilityFacts`.
 *
 * Source: implementation-plan.md work package P11-SUIT-01.
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
import { KyselyGardenContextFactRepository } from '../../src/modules/gardens-mapping/persistence/kysely-garden-context-fact-repository.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { createPlantDistributionAssertion } from '../../src/modules/integrations/domain/plant-distribution-assertion.js';
import { createPlantFactAssertion } from '../../src/modules/integrations/domain/plant-fact-assertion.js';
import { KyselyPlantDistributionAssertionRepository } from '../../src/modules/integrations/persistence/kysely-plant-distribution-assertion-repository.js';
import { KyselyPlantFactAssertionRepository } from '../../src/modules/integrations/persistence/kysely-plant-fact-assertion-repository.js';
import { KyselyPlantTaxonomyMappingRepository } from '../../src/modules/integrations/persistence/kysely-plant-taxonomy-mapping-repository.js';
import { AddCandidate } from '../../src/modules/plants-inventory/application/add-candidate.js';
import { RebuildPlantProfileVersion } from '../../src/modules/plants-inventory/application/rebuild-plant-profile-version.js';
import { RecalculateCandidateSuitability } from '../../src/modules/plants-inventory/application/recalculate-candidate-suitability.js';
import { createSuitabilityRuleCatalog } from '../../src/modules/plants-inventory/domain/suitability-rules/suitability-rule-catalog-instance.js';
import { KyselyCandidateSuitabilityAssessmentRepository } from '../../src/modules/plants-inventory/persistence/kysely-candidate-suitability-assessment-repository.js';
import { KyselyPlantCandidateRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-candidate-repository.js';
import { KyselyPlantProfileVersionRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-profile-version-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'candidate suitability integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-29T12:00:00Z');

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

  async function createGardenWithOwner() {
    const ownerId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({ id: ownerId, firebase_uid: `firebase-${ownerId}` })
      .execute();

    const clock = fixedClock(NOW);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());
    return { ownerId, gardenId: garden.id };
  }

  async function seedGardenContextFact(
    gardenId: string,
    ownerId: string,
    contextKind: string,
    value: string,
  ): Promise<void> {
    await db
      .insertInto('gardens_mapping.garden_context_fact')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        context_kind: contextKind,
        value,
        source: 'user_declared',
        recorded_by_profile_id: ownerId,
        recorded_at: NOW,
      })
      .execute();
  }

  async function freshTaxon(): Promise<string> {
    const taxonomyReferenceId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ficus carica',
        source: 'system_catalog',
      })
      .execute();
    return taxonomyReferenceId;
  }

  it('assembles real garden context and a real plant profile into a persisted suitability assessment', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    await seedGardenContextFact(gardenId, ownerId, 'sun_exposure', 'full_sun');
    await seedGardenContextFact(gardenId, ownerId, 'drainage', 'well_drained');

    const taxonomyReferenceId = await freshTaxon();
    await db
      .insertInto('integrations.plant_taxonomy_mapping')
      .values({
        id: randomUUID(),
        taxonomy_reference_id: taxonomyReferenceId,
        provider_key: 'usda-plants',
        provider_taxon_id: 'PROV-FICUS-1',
      })
      .execute();

    const factRepository = new KyselyPlantFactAssertionRepository(db);
    await factRepository.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: 'PROV-FICUS-1',
        rawFactKey: 'sunRequirement',
        factValue: 'full_sun',
        unit: null,
        confidence: 0.9,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'usda-plants',
          sourceCitation: 'USDA PLANTS',
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

    const distributionRepository = new KyselyPlantDistributionAssertionRepository(db);
    await distributionRepository.insert(
      createPlantDistributionAssertion({
        id: randomUUID(),
        rawProviderTaxonId: 'PROV-FICUS-1',
        rawRegion: 'US-CA',
        rawStatus: 'introduced',
        confidence: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'usda-plants',
          sourceCitation: 'USDA PLANTS',
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

    const mappingRepository = new KyselyPlantTaxonomyMappingRepository(db);
    const profileVersionRepository = new KyselyPlantProfileVersionRepository(db);
    const rebuild = new RebuildPlantProfileVersion(
      mappingRepository,
      factRepository,
      profileVersionRepository,
      generateUuidV7,
      fixedClock(NOW),
    );
    const rebuildResult = await rebuild.execute(taxonomyReferenceId, ['usda-plants']);
    expect(rebuildResult.outcome).toBe('rebuilt');

    const clock = fixedClock(NOW);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const candidateRepository = new KyselyPlantCandidateRepository(db);
    const addCandidate = new AddCandidate(idempotency, unitOfWork, authorization, clock);
    const candidate = await addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Fig tree', groupingKind: 'individual', taxonomyReferenceId },
      generateUuidV7(),
    );

    const assessmentRepository = new KyselyCandidateSuitabilityAssessmentRepository(db);
    const recalculate = new RecalculateCandidateSuitability(
      candidateRepository,
      new KyselyGardenContextFactRepository(db),
      profileVersionRepository,
      mappingRepository,
      distributionRepository,
      assessmentRepository,
      createSuitabilityRuleCatalog(),
      authorization,
      generateUuidV7,
      ['usda-plants'],
    );

    const result = await recalculate.execute(candidate.id, ownerId);

    expect(result.candidateId).toBe(candidate.id);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'match', axis: 'sun_exposure' }),
        expect.objectContaining({
          category: 'unknown',
          axis: 'drainage',
          reason: 'plant_fact_missing',
        }),
        expect.objectContaining({ category: 'assumption', axis: 'regulatory_status' }),
      ]),
    );

    const stored = await assessmentRepository.findLatest(candidate.id);
    expect(stored).toEqual(result);
  });

  it('produces an honest all-unknown assessment for a candidate with no identified taxon', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    await seedGardenContextFact(gardenId, ownerId, 'sun_exposure', 'full_sun');

    const clock = fixedClock(NOW);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const candidateRepository = new KyselyPlantCandidateRepository(db);
    const addCandidate = new AddCandidate(idempotency, unitOfWork, authorization, clock);
    const candidate = await addCandidate.execute(
      gardenId,
      ownerId,
      { displayName: 'Mystery seedling', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const recalculate = new RecalculateCandidateSuitability(
      candidateRepository,
      new KyselyGardenContextFactRepository(db),
      new KyselyPlantProfileVersionRepository(db),
      new KyselyPlantTaxonomyMappingRepository(db),
      new KyselyPlantDistributionAssertionRepository(db),
      new KyselyCandidateSuitabilityAssessmentRepository(db),
      createSuitabilityRuleCatalog(),
      authorization,
      generateUuidV7,
      ['usda-plants'],
    );

    const result = await recalculate.execute(candidate.id, ownerId);

    expect(result.findings).toEqual([
      { category: 'unknown', axis: 'sun_exposure', reason: 'plant_fact_missing' },
      { category: 'unknown', axis: 'drainage', reason: 'garden_context_missing' },
      { category: 'unknown', axis: 'regulatory_status', reason: 'plant_fact_missing' },
    ]);
  });
});
