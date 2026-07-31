import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  AMENDMENT_INPUT,
  MEDIA_ID,
  PROFILE_ID,
  buildHarness,
} from './correct-observation-test-support.js';

describe('CorrectObservation', () => {
  it('inserts a new row pointing back to the original, leaving the original row in the repository unchanged', async () => {
    const { correctObservation, observations, original } = buildHarness({});
    const originalSnapshot = { ...original };

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      AMENDMENT_INPUT,
      randomUUID(),
    );

    expect(resource).toMatchObject({
      gardenId: original.gardenId,
      plantId: original.plantId,
      correctionKind: 'amendment',
      correctsObservationId: original.id,
      noteText: 'Leaves recovered after watering.',
    });
    expect(observations.rows).toHaveLength(2);
    expect(observations.rows[0]).toEqual(originalSnapshot);
  });

  it("records its own sync-change entry, at the new row's recordId, not the original observation's", async () => {
    const { correctObservation, original, syncChanges } = buildHarness({});

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      AMENDMENT_INPUT,
      randomUUID(),
    );

    expect(syncChanges.entries).toEqual([
      {
        gardenId: original.gardenId,
        recordId: resource.id,
        recordType: 'observation',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
    expect(resource.id).not.toBe(original.id);
  });

  it('supports the supersede correction kind', async () => {
    const { correctObservation, original } = buildHarness({});

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      { ...AMENDMENT_INPUT, correctionKind: 'supersede' },
      randomUUID(),
    );

    expect(resource.correctionKind).toBe('supersede');
  });

  it('rejects correcting an observation that does not exist', async () => {
    const { correctObservation } = buildHarness({ seedOriginal: false });

    await expect(
      correctObservation.execute(randomUUID(), PROFILE_ID, AMENDMENT_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a correction with no note, no summary, and no photos', async () => {
    const { correctObservation, original, observations } = buildHarness({});

    await expect(
      correctObservation.execute(
        original.id,
        PROFILE_ID,
        { ...AMENDMENT_INPUT, noteText: null },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(1);
  });

  it('attaches photos, each with a stubbed, requires-confirmation analysis result', async () => {
    const { correctObservation, original } = buildHarness({ mediaIds: new Set([MEDIA_ID]) });

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      { ...AMENDMENT_INPUT, photos: [{ mediaId: MEDIA_ID, rawPurpose: 'leaf_front' }] },
      randomUUID(),
    );

    expect(resource.photos).toHaveLength(1);
    expect(resource.photos[0]?.analysisResults[0]?.requiresConfirmation).toBe(true);
  });

  it("rejects a caller who lacks editGardenContent on the original observation's garden", async () => {
    const { correctObservation, original } = buildHarness({ role: 'viewer' });

    await expect(
      correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('replays the same idempotency key without inserting a second correction', async () => {
    const { correctObservation, original, observations } = buildHarness({});
    const key = randomUUID();

    const first = await correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, key);
    const replay = await correctObservation.execute(original.id, PROFILE_ID, AMENDMENT_INPUT, key);
    expect(replay).toEqual(first);
    expect(observations.rows).toHaveLength(2);
  });
});
