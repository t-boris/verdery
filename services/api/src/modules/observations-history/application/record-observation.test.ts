import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import { GardenErrorCode } from '@verdery/api-contracts';
import type { GardenLifecycleState } from '../../gardens-mapping/public.js';
import {
  GARDEN_ID,
  GARDEN_OBJECT_ID,
  MEDIA_ID,
  NOTE_ONLY_INPUT,
  OTHER_GARDEN_ID,
  PLANT_ID,
  PROFILE_ID,
  buildHarness,
} from './record-observation-test-support.js';

describe('RecordObservation', () => {
  it.each<GardenLifecycleState>(['deletion_requested', 'purging'])(
    'refuses to record an observation in a %s garden, writing nothing',
    async (gardenLifecycleState) => {
      const { recordObservation, observations, syncChanges } = buildHarness({
        gardenLifecycleState,
        plantGardenIds: new Map([[PLANT_ID, GARDEN_ID]]),
      });

      await expect(
        recordObservation.execute(
          GARDEN_ID,
          PROFILE_ID,
          { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: GardenErrorCode.LifecycleConflict });

      expect(observations.rows).toHaveLength(0);
      expect(syncChanges.entries).toEqual([]);
    },
  );

  it('records a plant-level observation and returns it uncorrected', async () => {
    const { recordObservation, observations, syncChanges } = buildHarness({
      plantGardenIds: new Map([[PLANT_ID, GARDEN_ID]]),
    });

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
      randomUUID(),
    );

    expect(resource).toMatchObject({
      gardenId: GARDEN_ID,
      plantId: PLANT_ID,
      gardenObjectId: null,
      noteText: 'Leaves look wilted.',
      isCorrected: false,
      photos: [],
    });
    expect(observations.rows).toHaveLength(1);
    expect(syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: resource.id,
        recordType: 'observation',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
  });

  it('records a garden-object (area-level) observation', async () => {
    const { recordObservation } = buildHarness({});

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, gardenObjectId: GARDEN_OBJECT_ID, noteText: 'Bed is dry.' },
      randomUUID(),
    );

    expect(resource.plantId).toBeNull();
    expect(resource.gardenObjectId).toBe(GARDEN_OBJECT_ID);
  });

  it('records a photo-only observation, inserting one photo row and one stubbed, requires-confirmation analysis result', async () => {
    const { recordObservation, observationPhotos, imageAnalysisResults } = buildHarness({
      mediaIds: new Set([MEDIA_ID]),
    });

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      {
        ...NOTE_ONLY_INPUT,
        noteText: null,
        photos: [{ mediaId: MEDIA_ID, rawPurpose: 'leaf_front' }],
      },
      randomUUID(),
    );

    expect(resource.noteText).toBeNull();
    expect(resource.photos).toHaveLength(1);
    expect(resource.photos[0]).toMatchObject({ mediaId: MEDIA_ID, purpose: 'leaf_front' });
    expect(resource.photos[0]?.analysisResults[0]).toMatchObject({
      requiresConfirmation: true,
      analysisKind: 'other',
    });
    expect(observationPhotos.rows).toHaveLength(1);
    expect(imageAnalysisResults.rows).toHaveLength(1);
    expect(imageAnalysisResults.rows[0]?.requiresConfirmation).toBe(true);
  });

  it('rejects an observation with no note, no summary, and no photos, inserting nothing', async () => {
    const { recordObservation, observations } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, noteText: null },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(0);
  });

  it('rejects a plantId that belongs to a different garden', async () => {
    const { recordObservation, observations } = buildHarness({
      plantGardenIds: new Map([[PLANT_ID, OTHER_GARDEN_ID]]),
    });

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(0);
  });

  it('rejects a plantId that does not exist at all', async () => {
    const { recordObservation } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, plantId: PLANT_ID },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a photoMediaId that does not resolve to an existing media record, inserting no photo or analysis row for it', async () => {
    const { recordObservation, observationPhotos, imageAnalysisResults } = buildHarness({});

    // The fake unit of work runs `work` directly with no real rollback (see
    // `FakeUnitOfWork` in record-observation-test-support.ts, the same
    // simplification media's own fake makes) — the observation row itself,
    // inserted before this check runs, is therefore not asserted un-inserted
    // here. The real, transactional `KyselyObservationsHistoryUnitOfWork`
    // rolls the whole transaction back on this same thrown error; that
    // "nothing at all is left behind" case is covered by
    // tests/integration/observations-history.test.ts instead.
    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        {
          ...NOTE_ONLY_INPUT,
          noteText: null,
          photos: [{ mediaId: MEDIA_ID, rawPurpose: 'leaf_front' }],
        },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observationPhotos.rows).toHaveLength(0);
    expect(imageAnalysisResults.rows).toHaveLength(0);
  });

  it('rejects a caller who lacks editGardenContent (a viewer)', async () => {
    const { recordObservation } = buildHarness({ role: 'viewer' });

    await expect(
      recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('replays the same idempotency key without inserting a second observation, and rejects a reused key with a different body', async () => {
    const { recordObservation, observations } = buildHarness({});
    const key = randomUUID();

    const first = await recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, key);
    const replay = await recordObservation.execute(GARDEN_ID, PROFILE_ID, NOTE_ONLY_INPUT, key);
    expect(replay).toEqual(first);
    expect(observations.rows).toHaveLength(1);

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, noteText: 'A different note.' },
        key,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
