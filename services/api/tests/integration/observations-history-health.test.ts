/**
 * Full-stack integration tests for observations-history's P11-HEALTH-01
 * additions — real prior-photo history wired into `AnalyzePlantCondition`,
 * the new `image_analysis_result` columns, and `SetHealthSuggestionDisposition`
 * — against real PostgreSQL/PostGIS. Split out as its own file for the same
 * 600-line reason `observations-history-media.test.ts` was
 * (P11-MEDIA-01's own precedent).
 *
 * Source: implementation-plan.md work package P11-HEALTH-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import {
  AnalyzePlantCondition,
  KyselyProviderQuotaRepository,
  type PlantConditionAnalysisAdapterOutcome,
  type PlantConditionAnalysisProviderAdapter,
  type PlantConditionAnalysisRequest,
  type PlantConditionModelIdentity,
} from '../../src/modules/integrations/public.js';
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import {
  RecordObservation,
  type RecordObservationInput,
} from '../../src/modules/observations-history/application/record-observation.js';
import { SetHealthSuggestionDisposition } from '../../src/modules/observations-history/application/set-health-suggestion-disposition.js';
import { KyselyImageAnalysisResultRepository } from '../../src/modules/observations-history/persistence/kysely-image-analysis-result-repository.js';
import { KyselyObservationPhotoRepository } from '../../src/modules/observations-history/persistence/kysely-observation-photo-repository.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { KyselyObservationsHistoryUnitOfWork } from '../../src/modules/observations-history/persistence/kysely-observations-history-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { NotFoundError } from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'observations-history health suggestions (P11-HEALTH-01) integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

const BASE_INPUT: RecordObservationInput = {
  plantId: null,
  gardenObjectId: null,
  noteText: null,
  conditionSummary: null,
  observedAt: null,
  photos: [],
  measurements: [],
  symptoms: [],
  observedPhenologicalStage: null,
};

/** Records every request it receives, always answering with the same fixed observation — enough to prove `priorPhotos` threading without a real Vertex call. */
class RecordingPlantConditionAnalysisProviderAdapter implements PlantConditionAnalysisProviderAdapter {
  readonly identity: PlantConditionModelIdentity = {
    model: 'integration-test-model',
    promptTemplateVersion: 1,
  };

  readonly requests: PlantConditionAnalysisRequest[] = [];

  analyzeCondition(
    request: PlantConditionAnalysisRequest,
  ): Promise<PlantConditionAnalysisAdapterOutcome> {
    this.requests.push(request);
    return Promise.resolve({
      kind: 'observation',
      observation: {
        kind: 'stress',
        suggestedLabel: 'Wilting leaves',
        confidenceScore: 0.6,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: '',
        evidenceSummary: 'Leaf curl visible',
        alternativeExplanations: [],
        safetyClass: 'monitor',
        requestedViewPurposes: [],
      },
    });
  }
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

  async function createGardenWithOwner(now: Date): Promise<{ ownerId: string; gardenId: string }> {
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

  async function createPlant(gardenId: string, ownerId: string, now: Date): Promise<string> {
    const clock = fixedClock(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const addPlant = new AddPlant(
      new KyselyIdempotencyStore(db, clock),
      new KyselyPlantsInventoryUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const plant = await addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );
    return plant.id;
  }

  async function registerAvailableMedia(
    ownerId: string,
    gardenId: string,
    now: Date,
  ): Promise<string> {
    const clock = fixedClock(now);
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const record = await registerMediaRecord.execute(
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'leaf.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    // `RegisterMediaRecord` alone leaves `bucketName`/`objectKey` null (see
    // `domain/media-record.ts`) — a real upload-confirmation step sets both
    // together. This suite drives straight to `available` for a real
    // `AnalyzePlantCondition` request to reference, so both are set here
    // too, `objectKey` distinct per media id so a test can tell photos apart.
    await db
      .updateTable('media.media_record')
      .set({
        garden_id: gardenId,
        upload_state: 'available',
        bucket_name: 'test-user-media',
        object_key: `ab/${record.id}/${generateUuidV7()}`,
      })
      .where('id', '=', record.id)
      .execute();
    return record.id;
  }

  function buildHandlers(clock: Clock, adapter: PlantConditionAnalysisProviderAdapter | null) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyObservationsHistoryUnitOfWork(db, clock);
    const imageAnalysisResults = new KyselyImageAnalysisResultRepository(db);
    const analyzePlantCondition = new AnalyzePlantCondition(
      adapter,
      {
        providerKey: 'vertex-ai-plant-condition',
        callTimeoutMs: 1_000,
        quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
      },
      new KyselyProviderQuotaRepository(db),
      clock,
      pino({ level: 'silent' }),
    );
    return {
      recordObservation: new RecordObservation(
        idempotency,
        unitOfWork,
        authorization,
        clock,
        analyzePlantCondition,
      ),
      setHealthSuggestionDisposition: new SetHealthSuggestionDisposition(
        idempotency,
        unitOfWork,
        authorization,
        imageAnalysisResults,
        clock,
      ),
    };
  }

  it('records the new columns and defaults disposition to unresolved when the capability is disabled', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const mediaId = await registerAvailableMedia(ownerId, gardenId, now);
    const handlers = buildHandlers(fixedClock(now), null);

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, photos: [{ mediaId, rawPurpose: 'whole_plant' }] },
      generateUuidV7(),
    );

    const analysisResult = resource.photos[0]?.analysisResults[0];
    expect(analysisResult).toMatchObject({
      disposition: 'unresolved',
      dispositionSetAt: null,
      dispositionSetByProfileId: null,
      modelName: null,
      promptVersion: null,
      safetyClass: 'informational',
      evidenceSummary: '',
      alternativeExplanations: [],
      requestedViewPurposes: [],
    });

    const row = await db
      .selectFrom('observations_history.image_analysis_result')
      .selectAll()
      .where('id', '=', analysisResult!.id)
      .executeTakeFirstOrThrow();
    expect(row.disposition).toBe('unresolved');
    expect(row.alternative_explanations).toEqual([]);
  });

  it("threads the plant's own real prior photo history into the analysis request, oldest first, excluding the current observation", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const laterNow = new Date('2026-07-22T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const plantId = await createPlant(gardenId, ownerId, now);
    const firstMediaId = await registerAvailableMedia(ownerId, gardenId, now);
    const secondMediaId = await registerAvailableMedia(ownerId, gardenId, laterNow);

    const adapter = new RecordingPlantConditionAnalysisProviderAdapter();

    const firstHandlers = buildHandlers(fixedClock(now), adapter);
    await firstHandlers.recordObservation.execute(
      gardenId,
      ownerId,
      {
        ...BASE_INPUT,
        plantId,
        photos: [{ mediaId: firstMediaId, rawPurpose: 'whole_plant' }],
      },
      generateUuidV7(),
    );
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.priorPhotos).toEqual([]);

    const secondHandlers = buildHandlers(fixedClock(laterNow), adapter);
    await secondHandlers.recordObservation.execute(
      gardenId,
      ownerId,
      {
        ...BASE_INPUT,
        plantId,
        photos: [{ mediaId: secondMediaId, rawPurpose: 'whole_plant' }],
      },
      generateUuidV7(),
    );

    expect(adapter.requests).toHaveLength(2);
    const secondRequest = adapter.requests[1];
    expect(secondRequest?.priorPhotos).toHaveLength(1);
    expect(secondRequest?.priorPhotos[0]?.photo.objectKey).toContain(firstMediaId);
    expect(secondRequest?.photo.objectKey).toContain(secondMediaId);
  });

  it('does not query or thread prior-photo history for an area-level observation (no plantId)', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const mediaId = await registerAvailableMedia(ownerId, gardenId, now);
    const adapter = new RecordingPlantConditionAnalysisProviderAdapter();
    const handlers = buildHandlers(fixedClock(now), adapter);

    await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, photos: [{ mediaId, rawPurpose: 'whole_plant' }] },
      generateUuidV7(),
    );

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.priorPhotos).toEqual([]);
  });

  describe('SetHealthSuggestionDisposition', () => {
    async function recordAnalysisResult(
      handlers: ReturnType<typeof buildHandlers>,
      gardenId: string,
      ownerId: string,
      mediaId: string,
    ): Promise<string> {
      const resource = await handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, photos: [{ mediaId, rawPurpose: 'whole_plant' }] },
        generateUuidV7(),
      );
      return resource.photos[0]!.analysisResults[0]!.id;
    }

    it('sets and persists a disposition, then replays idempotently', async () => {
      const now = new Date('2026-07-21T09:00:00Z');
      const laterNow = new Date('2026-07-22T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const mediaId = await registerAvailableMedia(ownerId, gardenId, now);
      const handlers = buildHandlers(fixedClock(now), null);
      const analysisResultId = await recordAnalysisResult(handlers, gardenId, ownerId, mediaId);

      const laterHandlers = buildHandlers(fixedClock(laterNow), null);
      const key = generateUuidV7();
      const first = await laterHandlers.setHealthSuggestionDisposition.execute(
        analysisResultId,
        ownerId,
        'accepted_as_observation',
        key,
      );
      expect(first).toMatchObject({
        id: analysisResultId,
        disposition: 'accepted_as_observation',
        dispositionSetByProfileId: ownerId,
      });
      expect(first.dispositionSetAt).toBe(laterNow.toISOString());

      const row = await db
        .selectFrom('observations_history.image_analysis_result')
        .selectAll()
        .where('id', '=', analysisResultId)
        .executeTakeFirstOrThrow();
      expect(row.disposition).toBe('accepted_as_observation');
      expect(row.disposition_set_by_profile_id).toBe(ownerId);

      const replay = await laterHandlers.setHealthSuggestionDisposition.execute(
        analysisResultId,
        ownerId,
        'accepted_as_observation',
        key,
      );
      expect(replay).toEqual(first);
    });

    it('resets a disposition back to unresolved, clearing dispositionSetAt/dispositionSetByProfileId', async () => {
      const now = new Date('2026-07-21T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const mediaId = await registerAvailableMedia(ownerId, gardenId, now);
      const handlers = buildHandlers(fixedClock(now), null);
      const analysisResultId = await recordAnalysisResult(handlers, gardenId, ownerId, mediaId);

      await handlers.setHealthSuggestionDisposition.execute(
        analysisResultId,
        ownerId,
        'rejected',
        generateUuidV7(),
      );
      const reset = await handlers.setHealthSuggestionDisposition.execute(
        analysisResultId,
        ownerId,
        'unresolved',
        generateUuidV7(),
      );

      expect(reset.disposition).toBe('unresolved');
      expect(reset.dispositionSetAt).toBeNull();
      expect(reset.dispositionSetByProfileId).toBeNull();
    });

    it('rejects setting a disposition on an analysis result that does not exist', async () => {
      const now = new Date('2026-07-21T09:00:00Z');
      const { ownerId } = await createGardenWithOwner(now);
      const handlers = buildHandlers(fixedClock(now), null);

      await expect(
        handlers.setHealthSuggestionDisposition.execute(
          generateUuidV7(),
          ownerId,
          'rejected',
          generateUuidV7(),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("lists a plant's own prior analyzed photos oldest-first via KyselyObservationPhotoRepository directly, capped and self-excluding", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const plantId = await createPlant(gardenId, ownerId, now);
    const handlers = buildHandlers(fixedClock(now), null);
    const photoRepository = new KyselyObservationPhotoRepository(db);
    const observationRepository = new KyselyObservationRepository(db);

    const observationIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const observedAt = new Date(now.getTime() + index * 60_000);
      const mediaId = await registerAvailableMedia(ownerId, gardenId, observedAt);
      const resource = await handlers.recordObservation.execute(
        gardenId,
        ownerId,
        {
          ...BASE_INPUT,
          plantId,
          observedAt,
          photos: [{ mediaId, rawPurpose: 'whole_plant' }],
        },
        generateUuidV7(),
      );
      observationIds.push(resource.id);
    }

    const [firstObservation, , thirdObservation] = await Promise.all(
      observationIds.map((id) => observationRepository.get(id)),
    );
    void thirdObservation;

    const history = await photoRepository.listAnalysisHistoryForPlant(
      plantId,
      observationIds[2]!,
      10,
    );

    expect(history).toHaveLength(2);
    expect(history[0]?.observedAt.getTime()).toBeLessThan(history[1]!.observedAt.getTime());

    const cappedHistory = await photoRepository.listAnalysisHistoryForPlant(
      plantId,
      observationIds[2]!,
      1,
    );
    expect(cappedHistory).toHaveLength(1);
    expect(cappedHistory[0]?.observedAt.getTime()).toBe(firstObservation!.observedAt.getTime());
  });
});
