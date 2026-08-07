/**
 * Full HTTP-level contract tests for the plant-candidate, conversion,
 * suitability, and taxon-profile routes: the real Fastify application, the
 * real authentication plugin, and a real migrated PostgreSQL database — only
 * the Firebase Admin SDK boundary is faked. Mirrors `plant-routes.test.ts`'s
 * own structure and conventions exactly.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape) — the business logic each command implements, including the
 * concurrent-conversion race, is already covered by
 * `tests/integration/plant-candidates.test.ts`,
 * `tests/integration/candidate-suitability.test.ts`, and
 * `tests/integration/plant-profile-version.test.ts`.
 *
 * Source: packages/api-contracts/openapi.yaml, tags `PlantCandidates`,
 * `PlantCatalog`; implementation-plan.md work package P11-API-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { KyselyPlantProfileVersionRepository } from '../../src/modules/plants-inventory/public.js';
import type {
  ApiError,
  ConvertCandidateResult,
  Garden as GardenResource,
  PlantCandidate,
  PlantCandidateListResult,
  PlantTaxonProfileResult,
  SuitabilityAssessment,
} from '@verdery/api-contracts';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asCandidate(response: InjectResponse): PlantCandidate {
  return response.json<PlantCandidate>();
}

function asCandidateList(response: InjectResponse): PlantCandidateListResult {
  return response.json<PlantCandidateListResult>();
}

function asConvertResult(response: InjectResponse): ConvertCandidateResult {
  return response.json<ConvertCandidateResult>();
}

function asSuitability(response: InjectResponse): SuitabilityAssessment {
  return response.json<SuitabilityAssessment>();
}

function asProfile(response: InjectResponse): PlantTaxonProfileResult {
  return response.json<PlantTaxonProfileResult>();
}

function asGarden(response: InjectResponse): GardenResource {
  return response.json<GardenResource>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'plant-candidate routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents. */
class FakeTokenVerifier implements TokenVerifier {
  private readonly credentialsByToken = new Map<string, VerifiedCredential>();

  registerIdToken(token: string, firebaseUid: string): void {
    this.credentialsByToken.set(token, {
      firebaseUid,
      signInProvider: 'google.com',
      providerUid: firebaseUid,
      authenticatedAt: new Date(),
      email: `${firebaseUid}@example.com`,
      emailVerified: true,
    });
  }

  verifyIdToken(idToken: string): Promise<VerifiedCredential> {
    const credential = this.credentialsByToken.get(idToken);
    if (credential === undefined) {
      return Promise.reject(new Error('unknown test token'));
    }
    return Promise.resolve(credential);
  }

  createSessionCookie(): Promise<string> {
    return Promise.reject(new Error('not used by this suite'));
  }

  verifySessionCookie(sessionCookie: string): Promise<VerifiedCredential> {
    return this.verifyIdToken(sessionCookie);
  }

  revokeRefreshTokens(): Promise<void> {
    return Promise.resolve();
  }
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let tokenVerifier: FakeTokenVerifier;
  let app: FastifyInstance;

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

    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    app = await buildTestApplication({ database, tokenVerifier });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Candidate Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  async function addCandidate(
    token: string,
    gardenId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<PlantCandidate> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/plant-candidates`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Fig tree', groupingKind: 'individual', ...overrides },
    });
    expect(response.statusCode).toBe(201);
    return asCandidate(response);
  }

  it('rejects adding a candidate missing the Idempotency-Key header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates`,
      headers: bearer(token),
      payload: { displayName: 'Fig tree', groupingKind: 'individual' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('adds a candidate over real HTTP with the expected resource shape', async () => {
    const { token, garden } = await createGardenAsOwner();

    const candidate = await addCandidate(token, garden.id, { priority: 'high' });

    expect(candidate).toMatchObject({
      gardenId: garden.id,
      displayName: 'Fig tree',
      groupingKind: 'individual',
      status: 'active',
      priority: 'high',
      revision: 1,
    });
  });

  it('conceals a candidate that exists but belongs to a different garden as a 404', async () => {
    const { garden: otherGarden, token: otherToken } = await createGardenAsOwner();
    const foreign = await addCandidate(otherToken, otherGarden.id);

    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates/${foreign.id}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('plants_inventory.plant_candidate.not_found');
  });

  it('lists a garden candidates filtered by status', async () => {
    const { token, garden } = await createGardenAsOwner();
    const active = await addCandidate(token, garden.id, { displayName: 'Active candidate' });
    const archivedSeed = await addCandidate(token, garden.id, { displayName: 'To archive' });
    const archived = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${archivedSeed.id}/status`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(archivedSeed.revision)}"`,
      },
      payload: { status: 'archived' },
    });
    expect(archived.statusCode).toBe(200);

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates?status=active`,
      headers: bearer(token),
    });

    expect(filtered.statusCode).toBe(200);
    const page = asCandidateList(filtered);
    expect(page.items.map((item) => item.id)).toEqual([active.id]);
  });

  it('searches candidates by text query and the identified filter (P11-SEARCH-01)', async () => {
    const { token, garden } = await createGardenAsOwner();
    const fig = await addCandidate(token, garden.id, { displayName: 'Fig Tree' });
    const basil = await addCandidate(token, garden.id, { displayName: 'Basil' });

    const byQuery = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates?query=fyg+tree`,
      headers: bearer(token),
    });
    expect(byQuery.statusCode).toBe(200);
    expect(asCandidateList(byQuery).items.map((item) => item.id)).toEqual([fig.id]);

    // Neither candidate was added with a taxonomyReferenceId — both are
    // unidentified.
    const unidentified = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates?identified=false`,
      headers: bearer(token),
    });
    expect(unidentified.statusCode).toBe(200);
    expect(
      asCandidateList(unidentified)
        .items.map((item) => item.id)
        .sort(),
    ).toEqual([fig.id, basil.id].sort());

    const identified = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates?identified=true`,
      headers: bearer(token),
    });
    expect(identified.statusCode).toBe(200);
    expect(asCandidateList(identified).items).toHaveLength(0);
  });

  it('rejects updating candidate details with a missing If-Match header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidate = await addCandidate(token, garden.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Renamed fig' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('updates candidate details over real HTTP', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidate = await addCandidate(token, garden.id);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(candidate.revision)}"`,
      },
      payload: { displayName: 'Renamed fig', rationaleNote: 'Great shade tree' },
    });

    expect(updated.statusCode).toBe(200);
    expect(asCandidate(updated)).toMatchObject({
      displayName: 'Renamed fig',
      rationaleNote: 'Great shade tree',
      revision: candidate.revision + 1,
    });
  });

  it('404s a suitability read before any assessment has ever been computed', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidate = await addCandidate(token, garden.id);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/suitability`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe(
      'plants_inventory.plant_candidate.suitability_not_found',
    );
  });

  it('recalculates and then reads back a candidate suitability assessment over real HTTP', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidate = await addCandidate(token, garden.id);

    const recalculated = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/suitability`,
      headers: bearer(token),
    });
    expect(recalculated.statusCode).toBe(201);
    const assessment = asSuitability(recalculated);
    expect(assessment.candidateId).toBe(candidate.id);
    expect(assessment.findings.length).toBeGreaterThan(0);
    // No taxon and no declared garden context facts: every axis a rule
    // covers degrades to `unknown` — never a fabricated positive match.
    expect(assessment.findings.every((finding) => finding.category === 'unknown')).toBe(true);

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/suitability`,
      headers: bearer(token),
    });
    expect(fetched.statusCode).toBe(200);
    expect(asSuitability(fetched)).toMatchObject({ candidateId: candidate.id });
  });

  it('converts a candidate into a real plant over real HTTP', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidate = await addCandidate(token, garden.id, { displayName: 'Fig sapling' });

    const converted = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/convert`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(candidate.revision)}"`,
      },
      payload: {},
    });

    expect(converted.statusCode).toBe(201);
    const result = asConvertResult(converted);
    expect(result.plant).toMatchObject({
      gardenId: garden.id,
      displayName: 'Fig sapling',
      status: 'active',
    });
    expect(result.candidate).toMatchObject({ id: candidate.id, status: 'converted' });
    expect(result.conversion).toMatchObject({
      candidateId: candidate.id,
      plantId: result.plant.id,
    });

    const staleRetry = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/convert`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(candidate.revision)}"`,
      },
      payload: {},
    });
    expect(staleRetry.statusCode).toBe(412);
  });

  it('returns an empty profile envelope when no facts or images have been assembled', async () => {
    const { token } = await createGardenAsOwner();
    const taxonomyReferenceId = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Acer saccharum',
        common_name: 'Sugar maple',
        variety_name: null,
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/plant-catalog/taxa/${taxonomyReferenceId}/profile`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    expect(asProfile(response)).toMatchObject({
      taxonomyReference: {
        id: taxonomyReferenceId,
        scientificName: 'Acer saccharum',
        commonName: 'Sugar maple',
      },
      profile: null,
      images: [],
    });
  });

  it('serves a taxon materialized profile over real HTTP once one has been assembled', async () => {
    const { token } = await createGardenAsOwner();
    const taxonomyReferenceId = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyReferenceId,
        scientific_name: 'Ficus carica',
        common_name: 'Common fig',
        variety_name: null,
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();

    const profileVersions = new KyselyPlantProfileVersionRepository(db);
    await profileVersions.insert({
      id: generateUuidV7(),
      taxonomyReferenceId,
      resolvedFacts: [
        {
          factKey: 'matureHeightCm',
          value: 900,
          unit: 'cm',
          geographicScope: null,
          providerKey: 'human',
          confidence: null,
          sourceCitation: null,
          evidenceStatus: 'horticulturally_reviewed',
        },
      ],
      isPartial: false,
      createdAt: new Date(),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/plant-catalog/taxa/${taxonomyReferenceId}/profile`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    expect(asProfile(response)).toMatchObject({
      profile: {
        taxonomyReferenceId,
        isPartial: false,
        resolvedFacts: [{ factKey: 'matureHeightCm', value: 900, providerKey: 'human' }],
      },
      // No provider imagery for this taxon: an empty list, not an absent
      // field — a client renders "no pictures", not "unknown".
      images: [],
    });
  });
});
