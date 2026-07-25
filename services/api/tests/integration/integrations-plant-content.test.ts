/**
 * Full-stack integration tests for the integrations module's plant-content
 * half against real PostgreSQL/PostGIS: the real Kysely mapping, content,
 * quota, and taxonomy-identity adapters and the real use cases — only the
 * plant-content PROVIDER is a deterministic fake, because no real vendor
 * exists (P0-PROV-01 undecided; see `application/plant-content-provider.ts`).
 *
 * Covers P7-INT-02's acceptance evidence end to end — "Provider replacement
 * tests": two fakes through identical machinery, the switch is one
 * registration plus one mapping plus a configuration key change, both
 * providers' mappings and records coexist with their own license snapshots,
 * and the earlier provider's rows are untouched. Plus the machinery around
 * it: map/refresh/get round-trip with provenance, repeat-safety, the shared
 * quota counter across both operations, and the explicit re-identification
 * (rejection) flow that keeps a provider reorganization from silently
 * re-identifying anything.
 *
 * Source: implementation-plan.md work package P7-INT-02;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { GetPlantContent } from '../../src/modules/integrations/application/get-plant-content.js';
import {
  FakePlantContentProviderAdapter,
  SteppingClock,
  testPlantContent,
  testPlantContentProviderMetadata,
  testTaxonCandidate,
} from '../../src/modules/integrations/application/integrations-test-doubles.js';
import { MapPlantTaxonomy } from '../../src/modules/integrations/application/map-plant-taxonomy.js';
import {
  PlantContentProviderRegistry,
  type PlantContentProviderRegistration,
} from '../../src/modules/integrations/application/plant-content-provider-registry.js';
import { RefreshPlantContent } from '../../src/modules/integrations/application/refresh-plant-content.js';
import { validateMappingStateTransition } from '../../src/modules/integrations/domain/plant-taxonomy-mapping.js';
import { KyselyPlantContentRecordRepository } from '../../src/modules/integrations/persistence/kysely-plant-content-record-repository.js';
import { KyselyPlantTaxonomyMappingRepository } from '../../src/modules/integrations/persistence/kysely-plant-taxonomy-mapping-repository.js';
import { KyselyProviderQuotaRepository } from '../../src/modules/integrations/persistence/kysely-provider-quota-repository.js';
import { KyselyTaxonomyIdentitySource } from '../../src/modules/integrations/persistence/kysely-taxonomy-identity-source.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'integrations plant-content integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const START = new Date('2026-07-25T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const REFETCH = { contentFreshForMs: HOUR_MS };

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertTaxonomyReference(scientificName: string): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: scientificName,
        common_name: 'Tomato',
        source: 'system_catalog',
      })
      .execute();
    return id;
  }

  interface Composition {
    readonly map: MapPlantTaxonomy;
    readonly refresh: RefreshPlantContent;
    readonly get: GetPlantContent;
  }

  /** The full real-adapter composition for one active key — what a composition root would build when a provider lands. */
  function compose(
    registrations: readonly PlantContentProviderRegistration[],
    activeProviderKey: string,
    clock: SteppingClock,
    refetchPolicy = REFETCH,
  ): Composition {
    const registry = new PlantContentProviderRegistry(registrations);
    const mappings = new KyselyPlantTaxonomyMappingRepository(db);
    const contentRecords = new KyselyPlantContentRecordRepository(db);
    const quotas = new KyselyProviderQuotaRepository(db);
    return {
      map: new MapPlantTaxonomy(
        registry,
        { activeProviderKey },
        mappings,
        new KyselyTaxonomyIdentitySource(db),
        quotas,
        clock,
      ),
      refresh: new RefreshPlantContent(
        registry,
        { activeProviderKey, refetchPolicy },
        contentRecords,
        mappings,
        quotas,
        clock,
      ),
      get: new GetPlantContent(activeProviderKey, mappings, contentRecords),
    };
  }

  function fakeRegistration(
    providerKey: string,
    taxonId: string,
    jurisdiction: string | null = null,
  ): { registration: PlantContentProviderRegistration; adapter: FakePlantContentProviderAdapter } {
    const adapter = new FakePlantContentProviderAdapter(
      {
        kind: 'succeed',
        candidates: [testTaxonCandidate({ providerTaxonId: taxonId, confidence: 0.9 })],
      },
      {
        kind: 'succeed',
        content: testPlantContent({
          source: {
            providerRecordId: `${providerKey}-record`,
            providerContentVersion: 'v1',
            contentLanguage: 'en',
          },
        }),
      },
    );
    return {
      registration: {
        metadata: testPlantContentProviderMetadata(providerKey, { jurisdiction }),
        adapter,
      },
      adapter,
    };
  }

  it('maps, refreshes, and reads back whole: identity mapping, licensed sections, and provenance survive the round-trip', async () => {
    const referenceId = await insertTaxonomyReference(`Solanum lycopersicum ${randomUUID()}`);
    const providerKey = `fake-plant-provider-${randomUUID()}`;
    const { registration, adapter } = fakeRegistration(providerKey, 'taxon-1001', 'EU');
    const clock = new SteppingClock(START);
    const { map, refresh, get } = compose([registration], providerKey, clock);

    const mapped = await map.execute({ taxonomyReferenceId: referenceId });
    expect(mapped.outcome).toBe('mapped');
    // The search was phrased with the catalog's own identity facts, read
    // through the real cross-schema source.
    expect(adapter.lastSearchQuery?.commonName).toBe('Tomato');

    const refreshed = await refresh.execute({ taxonomyReferenceId: referenceId });
    expect(refreshed.outcome).toBe('refreshed');

    const read = await get.execute({ taxonomyReferenceId: referenceId });
    expect(read.outcome).toBe('available');
    if (read.outcome === 'available') {
      expect(read.mapping.providerTaxonId).toBe('taxon-1001');
      expect(read.mapping.verificationState).toBe('unverified');
      expect(read.mapping.confidence).toBe(0.9);
      expect(read.record.providerKey).toBe(providerKey);
      expect(read.record.sections.careGuidance).toBe('Water regularly; avoid wetting foliage.');
      expect(read.record.licenseNote).toBe(registration.metadata.licenseNote);
      expect(read.record.attributionText).toBe(registration.metadata.attributionText);
      expect(read.record.jurisdiction).toBe('EU');
      expect(read.record.presentationNote).toBe(registration.metadata.presentationNote);
      expect(read.record.fetchedAt).toEqual(START);
    }
  });

  it('is repeat-safe through the real stores: alreadyMapped and contentCurrent without further provider calls', async () => {
    const referenceId = await insertTaxonomyReference(`Solanum lycopersicum ${randomUUID()}`);
    const providerKey = `fake-plant-provider-${randomUUID()}`;
    const { registration, adapter } = fakeRegistration(providerKey, 'taxon-1001');
    const clock = new SteppingClock(START);
    const { map, refresh } = compose([registration], providerKey, clock);

    await map.execute({ taxonomyReferenceId: referenceId });
    await refresh.execute({ taxonomyReferenceId: referenceId });
    clock.advanceMs(REFETCH.contentFreshForMs); // boundary: still current

    await expect(map.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'alreadyMapped',
    });
    await expect(refresh.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'contentCurrent',
    });
    expect(adapter.searchCallCount).toBe(1);
    expect(adapter.fetchCallCount).toBe(1);
  });

  it('shares one quota budget across the capability’s operations through the real counter table', async () => {
    const referenceId = await insertTaxonomyReference(`Solanum lycopersicum ${randomUUID()}`);
    const providerKey = `fake-plant-provider-${randomUUID()}`;
    const { adapter } = fakeRegistration(providerKey, 'taxon-1001');
    const metadata = testPlantContentProviderMetadata(providerKey, {
      quotaLimits: { maxCallsPerHour: 1, maxCallsPerDay: null },
    });
    const clock = new SteppingClock(START);
    const { map, refresh } = compose([{ metadata, adapter }], providerKey, clock);

    // The mapping search consumes the hour's single budgeted call…
    await expect(map.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'mapped',
    });
    // …so the content fetch is a typed refusal, not a silently skipped call.
    await expect(refresh.execute({ taxonomyReferenceId: referenceId })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'quotaExhausted',
    });
    expect(adapter.fetchCallCount).toBe(0);

    const usage = await db
      .selectFrom('integrations.provider_quota_usage')
      .select(['window_kind', 'call_count'])
      .where('provider_key', '=', providerKey)
      .orderBy('window_kind')
      .execute();
    expect(usage).toEqual([
      { window_kind: 'day', call_count: 1 },
      { window_kind: 'hour', call_count: 1 },
    ]);
  });

  it('replaces the provider with one registration, one mapping, and a configuration change, leaving prior records untouched', async () => {
    const referenceId = await insertTaxonomyReference(`Solanum lycopersicum ${randomUUID()}`);
    const keyA = `fake-plant-provider-a-${randomUUID()}`;
    const keyB = `fake-plant-provider-b-${randomUUID()}`;
    const a = fakeRegistration(keyA, 'a-taxon-1', 'EU');
    const b = fakeRegistration(keyB, 'b-taxon-42', 'US');
    const registrations = [a.registration, b.registration];
    const clock = new SteppingClock(START);

    // Provider A is active: map and fetch.
    const underA = compose(registrations, keyA, clock);
    await underA.map.execute({ taxonomyReferenceId: referenceId });
    await underA.refresh.execute({ taxonomyReferenceId: referenceId });

    // The replacement: the SAME machinery and stores, a different configured
    // key. Provider B's taxonomy is its own — nothing leaks from A's
    // mapping, so content is a typed taxonomyNotMapped until B's identity is
    // explicitly resolved.
    const underB = compose(registrations, keyB, clock);
    await expect(underB.refresh.execute({ taxonomyReferenceId: referenceId })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'taxonomyNotMapped',
    });
    await expect(underB.map.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'mapped',
    });
    await expect(
      underB.refresh.execute({ taxonomyReferenceId: referenceId }),
    ).resolves.toMatchObject({ outcome: 'refreshed' });

    expect(a.adapter.fetchCallCount).toBe(1);
    expect(b.adapter.fetchCallCount).toBe(1);

    // Both providers' rows coexist, each with its own provider key, taxon
    // identity, and license/jurisdiction snapshot; provider A's rows are
    // untouched history — "Provider selection ... does not change domain
    // records silently."
    const contentRows = await db
      .selectFrom('integrations.plant_content_record')
      .select(['provider_key', 'provider_taxon_id', 'license_note', 'jurisdiction'])
      .where('provider_key', 'in', [keyA, keyB])
      .orderBy('fetched_at')
      .orderBy('created_at')
      .execute();
    expect(contentRows).toEqual([
      {
        provider_key: keyA,
        provider_taxon_id: 'a-taxon-1',
        license_note: `${keyA} test license: internal use only`,
        jurisdiction: 'EU',
      },
      {
        provider_key: keyB,
        provider_taxon_id: 'b-taxon-42',
        license_note: `${keyB} test license: internal use only`,
        jurisdiction: 'US',
      },
    ]);
    const mappingRows = await db
      .selectFrom('integrations.plant_taxonomy_mapping')
      .select(['provider_key', 'provider_taxon_id', 'verification_state'])
      .where('taxonomy_reference_id', '=', referenceId)
      .orderBy('created_at')
      .execute();
    expect(mappingRows).toEqual([
      { provider_key: keyA, provider_taxon_id: 'a-taxon-1', verification_state: 'unverified' },
      { provider_key: keyB, provider_taxon_id: 'b-taxon-42', verification_state: 'unverified' },
    ]);

    // Each active key reads its OWN provider's content — and switching back
    // to A finds everything exactly as it was.
    const readB = await underB.get.execute({ taxonomyReferenceId: referenceId });
    expect(readB.outcome).toBe('available');
    if (readB.outcome === 'available') {
      expect(readB.record.providerKey).toBe(keyB);
    }
    const readA = await underA.get.execute({ taxonomyReferenceId: referenceId });
    expect(readA.outcome).toBe('available');
    if (readA.outcome === 'available') {
      expect(readA.record.providerKey).toBe(keyA);
      expect(readA.record.jurisdiction).toBe('EU');
    }
  });

  it('keeps a provider reorganization explicit: reject the mapping, remap, and stored content never re-identifies', async () => {
    const referenceId = await insertTaxonomyReference(`Solanum lycopersicum ${randomUUID()}`);
    const providerKey = `fake-plant-provider-${randomUUID()}`;
    const { registration, adapter } = fakeRegistration(providerKey, 'taxon-old');
    const clock = new SteppingClock(START);
    const { map, refresh, get } = compose([registration], providerKey, clock);
    const mappings = new KyselyPlantTaxonomyMappingRepository(db);

    const mapped = await map.execute({ taxonomyReferenceId: referenceId });
    await refresh.execute({ taxonomyReferenceId: referenceId });
    expect(mapped.outcome).toBe('mapped');
    if (mapped.outcome !== 'mapped') {
      return;
    }

    // The explicit re-identification event, exactly as a future verification
    // surface would perform it: domain-validated transition, then the
    // guarded update.
    validateMappingStateTransition(mapped.mapping.verificationState, 'rejected');
    await expect(
      mappings.updateVerificationState(
        mapped.mapping.id,
        'unverified',
        'rejected',
        'provider reorganized its taxonomy',
        clock.now(),
      ),
    ).resolves.toBe(true);

    // No live mapping: content stops resolving, and its rows persist as the
    // provider's history under the OLD taxon identity.
    await expect(get.execute({ taxonomyReferenceId: referenceId })).resolves.toEqual({
      outcome: 'noContent',
      reason: 'taxonomyNotMapped',
    });
    const oldRows = await db
      .selectFrom('integrations.plant_content_record')
      .select(['provider_taxon_id'])
      .where('provider_key', '=', providerKey)
      .execute();
    expect(oldRows).toEqual([{ provider_taxon_id: 'taxon-old' }]);

    // The explicit replacement: the provider now reports the reorganized
    // taxon, and a NEW mapping row claims it — the rejected row stays.
    adapter.setSearchBehavior({
      kind: 'succeed',
      candidates: [testTaxonCandidate({ providerTaxonId: 'taxon-new', confidence: 0.95 })],
    });
    await expect(map.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'mapped',
    });
    clock.advanceMs(REFETCH.contentFreshForMs + 1);
    await expect(refresh.execute({ taxonomyReferenceId: referenceId })).resolves.toMatchObject({
      outcome: 'refreshed',
    });

    const history = await db
      .selectFrom('integrations.plant_taxonomy_mapping')
      .select(['provider_taxon_id', 'verification_state', 'state_note'])
      .where('taxonomy_reference_id', '=', referenceId)
      .orderBy('created_at')
      .execute();
    expect(history).toEqual([
      {
        provider_taxon_id: 'taxon-old',
        verification_state: 'rejected',
        state_note: 'provider reorganized its taxonomy',
      },
      { provider_taxon_id: 'taxon-new', verification_state: 'unverified', state_note: null },
    ]);

    const read = await get.execute({ taxonomyReferenceId: referenceId });
    expect(read.outcome).toBe('available');
    if (read.outcome === 'available') {
      expect(read.record.providerTaxonId).toBe('taxon-new');
    }
  });
});
