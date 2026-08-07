/**
 * Full-stack integration test for P11-ASYNC-01's taxon-enrichment pipeline
 * against real PostgreSQL/PostGIS: the real Kysely repositories, the real
 * `RefreshTaxonAssertions`/`RunTaxonEnrichmentSweep`/`RebuildPlantProfileVersion`
 * use cases — not fakes, except the provider adapter itself (no real
 * network call belongs in this suite; `usda-plants-adapter.test.ts` already
 * covers the adapter's own HTTP/payload behavior against recorded shapes).
 *
 * Covers the full round trip: a real garden candidate makes its taxon a
 * real enrichment candidate; `RefreshTaxonAssertions` resolves a mapping and
 * persists real, correctly-provenanced `awaiting_horticultural_review`
 * assertion rows; `RebuildPlantProfileVersion` honestly reports nothing to
 * resolve until a row is reviewed; `RunTaxonEnrichmentSweep` drives the
 * whole cycle end to end.
 *
 * Source: implementation-plan.md work package P11-ASYNC-01;
 *         migrations/1787700000000_plant-taxon-knowledge-profile.sql.
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
import { AddCandidate } from '../../src/modules/plants-inventory/application/add-candidate.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { createPlantFactAssertion } from '../../src/modules/integrations/domain/plant-fact-assertion.js';
import { KyselyPlantFactAssertionRepository } from '../../src/modules/integrations/persistence/kysely-plant-fact-assertion-repository.js';
import { KyselyPlantMediaAssetRepository } from '../../src/modules/integrations/persistence/kysely-plant-media-asset-repository.js';
import { KyselyPlantDistributionAssertionRepository } from '../../src/modules/integrations/persistence/kysely-plant-distribution-assertion-repository.js';
import { KyselyPlantTaxonomyMappingRepository } from '../../src/modules/integrations/persistence/kysely-plant-taxonomy-mapping-repository.js';
import { KyselyTaxonomyIdentitySource } from '../../src/modules/integrations/persistence/kysely-taxonomy-identity-source.js';
import { KyselyProviderQuotaRepository } from '../../src/modules/integrations/persistence/kysely-provider-quota-repository.js';
import { KyselyTaxonEnrichmentCandidateSource } from '../../src/modules/integrations/persistence/kysely-taxon-enrichment-candidate-source.js';
import { PlantAssertionProviderRegistry } from '../../src/modules/integrations/application/plant-assertion-provider-registry.js';
import { RefreshTaxonAssertions } from '../../src/modules/integrations/application/refresh-taxon-assertions.js';
import { RunTaxonEnrichmentSweep } from '../../src/modules/integrations/application/run-taxon-enrichment-sweep.js';
import { FakePlantAssertionProviderAdapter } from '../../src/modules/integrations/application/plant-assertion-provider-test-doubles.js';
import { RebuildPlantProfileVersion } from '../../src/modules/plants-inventory/application/rebuild-plant-profile-version.js';
import { KyselyPlantProfileVersionRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-profile-version-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'taxon enrichment integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const PROVIDER_KEY = 'usda-plants';

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

  async function seedTaxonomyReference(now: Date): Promise<string> {
    const taxonomyReferenceId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Quercus alba',
        common_name: 'White oak',
        source: 'system_catalog',
        created_at: now,
      })
      .execute();
    return taxonomyReferenceId;
  }

  /** A real candidate referencing the taxon — the fact that makes it a real enrichment candidate. */
  async function seedCandidateReferencingTaxon(
    now: Date,
    taxonomyReferenceId: string,
  ): Promise<void> {
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const addCandidate = new AddCandidate(
      new KyselyIdempotencyStore(db, clock),
      new KyselyPlantsInventoryUnitOfWork(db, clock),
      authorization,
      clock,
    );
    await addCandidate.execute(
      garden.id,
      ownerId,
      { displayName: 'Fig sapling', groupingKind: 'individual', taxonomyReferenceId },
      generateUuidV7(),
    );
  }

  function buildAssertionPipeline(now: Date, adapter: FakePlantAssertionProviderAdapter) {
    const registry = new PlantAssertionProviderRegistry([
      {
        metadata: {
          providerKey: PROVIDER_KEY,
          displayName: 'USDA PLANTS Database',
          licenseNote: 'Public domain test license.',
          citationText: 'USDA NRCS PLANTS Database. https://plants.usda.gov.',
          attributionText: null,
          fetchTimeoutMs: 5_000,
          quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
        },
        adapter,
      },
    ]);
    const mappings = new KyselyPlantTaxonomyMappingRepository(db);
    const facts = new KyselyPlantFactAssertionRepository(db);
    const distributionAssertions = new KyselyPlantDistributionAssertionRepository(db);
    const mediaAssets = new KyselyPlantMediaAssetRepository(db);
    const refreshTaxonAssertions = new RefreshTaxonAssertions(
      registry,
      mappings,
      new KyselyTaxonomyIdentitySource(db),
      facts,
      distributionAssertions,
      mediaAssets,
      new KyselyProviderQuotaRepository(db),
      randomUUID,
      fixedClock(now),
    );
    const rebuildPlantProfileVersion = new RebuildPlantProfileVersion(
      mappings,
      facts,
      new KyselyPlantProfileVersionRepository(db),
      randomUUID,
      fixedClock(now),
    );
    return {
      mappings,
      facts,
      distributionAssertions,
      refreshTaxonAssertions,
      rebuildPlantProfileVersion,
    };
  }

  it('lists a taxon referenced by a real candidate as an enrichment candidate', async () => {
    const now = new Date('2026-07-31T09:00:00Z');
    const taxonomyReferenceId = await seedTaxonomyReference(now);
    await seedCandidateReferencingTaxon(now, taxonomyReferenceId);

    const candidates = new KyselyTaxonEnrichmentCandidateSource(db);
    const ids = await candidates.listEnrichmentCandidates(10);

    expect(ids).toContain(taxonomyReferenceId);
  });

  it('fetches and persists source-backed assertions, then prefers a reviewed assertion', async () => {
    const now = new Date('2026-07-31T10:00:00Z');
    const taxonomyReferenceId = await seedTaxonomyReference(now);
    // A unique-per-test provider taxon id: `plant_fact_assertion`/
    // `plant_taxonomy_mapping` are anchored on `(providerKey,
    // providerTaxonId)`, a GLOBAL identity shared across every taxonomy
    // reference that maps to it (correct production behavior — two app-taxa
    // resolving to the same real USDA PLANTS id genuinely should share
    // facts). Reusing one fixed id across tests in this shared container
    // would let one test's reviewed fact leak into another's "nothing
    // reviewed yet" assertion.
    const providerTaxonId = `test-${randomUUID()}`;

    const adapter = new FakePlantAssertionProviderAdapter(
      {
        kind: 'succeed',
        candidates: [{ providerTaxonId, scientificName: 'Quercus alba', confidence: null }],
      },
      {
        kind: 'succeed',
        value: [
          {
            factKey: 'growth_habit',
            value: 'Tree',
            unit: null,
            confidence: null,
            geographicScope: null,
          },
        ],
      },
      { kind: 'succeed', value: [{ region: 'L48', rawStatus: 'native', confidence: null }] },
    );
    const {
      mappings,
      facts,
      distributionAssertions,
      refreshTaxonAssertions,
      rebuildPlantProfileVersion,
    } = buildAssertionPipeline(now, adapter);

    const refreshed = await refreshTaxonAssertions.execute({
      taxonomyReferenceId,
      providerKey: PROVIDER_KEY,
    });
    expect(refreshed).toMatchObject({
      outcome: 'refreshed',
      factsWritten: 1,
      distributionWritten: 1,
    });

    const liveMapping = await mappings.findLive(PROVIDER_KEY, taxonomyReferenceId);
    expect(liveMapping).toMatchObject({ providerTaxonId, verificationState: 'unverified' });

    const storedFacts = await facts.findAllForProviderTaxon(PROVIDER_KEY, providerTaxonId);
    expect(storedFacts).toHaveLength(1);
    expect(storedFacts[0]?.provenance.reviewStatus).toBe('awaiting_horticultural_review');
    const storedDistribution = await distributionAssertions.findAllForProviderTaxon(
      PROVIDER_KEY,
      providerTaxonId,
    );
    expect(storedDistribution).toHaveLength(1);

    // Real cited provider data is immediately visible as source-backed.
    const beforeReview = await rebuildPlantProfileVersion.execute(taxonomyReferenceId, [
      PROVIDER_KEY,
    ]);
    expect(beforeReview).toMatchObject({
      outcome: 'rebuilt',
      version: {
        resolvedFacts: [
          { factKey: 'growth_habit', value: 'Tree', evidenceStatus: 'source_backed' },
        ],
      },
    });

    // Once a human reviewer promotes the SAME identity to reviewed, it
    // resolves — the exact `plant-profile-version.test.ts` reviewed-vs-
    // unreviewed precedent, applied to a row this pipeline itself produced.
    await facts.insert(
      createPlantFactAssertion({
        id: randomUUID(),
        rawProviderTaxonId: providerTaxonId,
        rawFactKey: 'growth_habit',
        factValue: 'Tree',
        unit: null,
        confidence: null,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: PROVIDER_KEY,
          sourceCitation: 'USDA PLANTS Database, reviewed copy for this test',
        },
        review: {
          reviewStatus: 'horticulturally_reviewed',
          reviewedBy: 'Dr. Amara Osei',
          reviewedOn: '2026-07-31',
        },
        fetchedAt: now,
        now,
      }),
    );

    const afterReview = await rebuildPlantProfileVersion.execute(taxonomyReferenceId, [
      PROVIDER_KEY,
    ]);
    expect(afterReview.outcome).toBe('rebuilt');
    if (afterReview.outcome !== 'rebuilt') {
      throw new Error('expected rebuilt');
    }
    expect(afterReview.version.resolvedFacts).toEqual([
      {
        factKey: 'growth_habit',
        value: 'Tree',
        unit: null,
        geographicScope: null,
        providerKey: PROVIDER_KEY,
        confidence: null,
        sourceCitation: 'USDA PLANTS Database, reviewed copy for this test',
        evidenceStatus: 'horticulturally_reviewed',
      },
    ]);
  });

  it('stores occurrence counts as evidence but keeps them out of the profile, and cites the source in one sentence', async () => {
    const now = new Date('2026-07-31T11:00:00Z');
    const taxonomyReferenceId = await seedTaxonomyReference(now);
    const providerTaxonId = `test-${randomUUID()}`;

    // What a real GBIF refresh produces for a common taxon: one nationwide
    // count plus one per state facet, alongside an actual characteristic.
    const adapter = new FakePlantAssertionProviderAdapter(
      {
        kind: 'succeed',
        candidates: [{ providerTaxonId, scientificName: 'Quercus alba', confidence: null }],
      },
      {
        kind: 'succeed',
        value: [
          {
            factKey: 'growth_habit',
            value: 'Tree',
            unit: null,
            confidence: null,
            geographicScope: null,
          },
          {
            factKey: 'occurrence_evidence_count',
            value: '1792',
            unit: 'records',
            confidence: null,
            geographicScope: null,
          },
          {
            factKey: 'occurrence_evidence_count',
            value: '53',
            unit: 'records',
            confidence: null,
            geographicScope: 'Pennsylvania',
          },
          // GBIF's stateProvince facet is free text, so real data carries
          // entries like this one beside the properly-spelled states.
          {
            factKey: 'occurrence_evidence_count',
            value: '1',
            unit: 'records',
            confidence: null,
            geographicScope: 'Dallas',
          },
        ],
      },
      { kind: 'succeed', value: [] },
    );
    const { facts, refreshTaxonAssertions, rebuildPlantProfileVersion } = buildAssertionPipeline(
      now,
      adapter,
    );

    const refreshed = await refreshTaxonAssertions.execute({
      taxonomyReferenceId,
      providerKey: PROVIDER_KEY,
    });
    expect(refreshed).toMatchObject({ outcome: 'refreshed', factsWritten: 4 });

    // The evidence is kept: nothing is thrown away, it simply is not profile
    // content.
    const storedFacts = await facts.findAllForProviderTaxon(PROVIDER_KEY, providerTaxonId);
    expect(storedFacts).toHaveLength(4);
    expect(storedFacts.filter((fact) => fact.factKey === 'occurrence_evidence_count')).toHaveLength(
      3,
    );

    // The citation stamped on every assertion is the SOURCE's one-sentence
    // citation — not the internal compliance memo that used to be stored
    // here and printed under every fact on the catalog page.
    const citations = new Set(
      storedFacts.map((fact) =>
        fact.provenance.authoringMethod === 'ai_extracted_from_source'
          ? fact.provenance.sourceCitation
          : null,
      ),
    );
    expect(citations).toEqual(new Set(['USDA NRCS PLANTS Database. https://plants.usda.gov.']));

    const rebuilt = await rebuildPlantProfileVersion.execute(taxonomyReferenceId, [PROVIDER_KEY]);
    expect(rebuilt.outcome).toBe('rebuilt');
    if (rebuilt.outcome !== 'rebuilt') {
      throw new Error('expected rebuilt');
    }
    // One row, and it is the characteristic somebody opened the page for —
    // not fifty rows of sighting counts ahead of it.
    expect(rebuilt.version.resolvedFacts).toHaveLength(1);
    expect(rebuilt.version.resolvedFacts[0]?.factKey).toBe('growth_habit');
  });

  it('drives the full sweep over a real candidate end to end', async () => {
    const now = new Date('2026-07-31T11:00:00Z');
    const taxonomyReferenceId = await seedTaxonomyReference(now);
    await seedCandidateReferencingTaxon(now, taxonomyReferenceId);
    // Unique per test — see the previous test's comment on why.
    const providerTaxonId = `test-${randomUUID()}`;

    const adapter = new FakePlantAssertionProviderAdapter(
      {
        kind: 'succeed',
        candidates: [{ providerTaxonId, scientificName: 'Quercus alba', confidence: null }],
      },
      { kind: 'succeed', value: [] },
      { kind: 'succeed', value: [] },
    );
    const { refreshTaxonAssertions, rebuildPlantProfileVersion } = buildAssertionPipeline(
      now,
      adapter,
    );
    const sweep = new RunTaxonEnrichmentSweep(
      new KyselyTaxonEnrichmentCandidateSource(db),
      refreshTaxonAssertions,
      rebuildPlantProfileVersion,
      [PROVIDER_KEY],
      fixedClock(now),
    );

    const result = await sweep.execute();

    expect(result.taxaConsidered).toBeGreaterThanOrEqual(1);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    // Zero facts/distribution from this adapter script: an honest,
    // real "nothing to resolve yet" outcome, not a crash.
    expect(result.profilesWithNothingToResolve).toBeGreaterThanOrEqual(1);
    expect(adapter.searchCallCount).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
