import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  createCorrectionObservation,
  createObservation,
  requireObservationContent,
} from './observation.js';

const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a03';
const GARDEN_OBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a04';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a05';
const OBSERVED_AT = new Date('2026-07-20T08:00:00Z');
const NOW = new Date('2026-07-21T09:00:00Z');

describe('createObservation', () => {
  it('builds a user-authored, uncorrected observation, trimming note and summary text', () => {
    const observation = createObservation({
      id: OBSERVATION_ID,
      gardenId: GARDEN_ID,
      plantId: PLANT_ID,
      gardenObjectId: null,
      actorProfileId: PROFILE_ID,
      rawNoteText: '  Leaves look wilted.  ',
      rawConditionSummary: '  stressed  ',
      observedAt: OBSERVED_AT,
      photoCount: 0,
      now: NOW,
    });

    expect(observation).toEqual({
      id: OBSERVATION_ID,
      gardenId: GARDEN_ID,
      plantId: PLANT_ID,
      gardenObjectId: null,
      actorType: 'user',
      createdByProfileId: PROFILE_ID,
      noteText: 'Leaves look wilted.',
      conditionSummary: 'stressed',
      correctionKind: null,
      correctsObservationId: null,
      observedAt: OBSERVED_AT,
      recordedAt: NOW,
    });
  });

  it('accepts an area-level observation (gardenObjectId set, plantId null)', () => {
    const observation = createObservation({
      id: OBSERVATION_ID,
      gardenId: GARDEN_ID,
      plantId: null,
      gardenObjectId: GARDEN_OBJECT_ID,
      actorProfileId: PROFILE_ID,
      rawNoteText: 'Bed looks dry.',
      rawConditionSummary: null,
      observedAt: OBSERVED_AT,
      photoCount: 0,
      now: NOW,
    });

    expect(observation.plantId).toBeNull();
    expect(observation.gardenObjectId).toBe(GARDEN_OBJECT_ID);
  });

  it('accepts a photo-only observation with no note or summary', () => {
    const observation = createObservation({
      id: OBSERVATION_ID,
      gardenId: GARDEN_ID,
      plantId: null,
      gardenObjectId: null,
      actorProfileId: PROFILE_ID,
      rawNoteText: null,
      rawConditionSummary: null,
      observedAt: OBSERVED_AT,
      photoCount: 1,
      now: NOW,
    });

    expect(observation.noteText).toBeNull();
    expect(observation.conditionSummary).toBeNull();
  });

  it('rejects an observation with no note, no summary, and no photos', () => {
    expect(() =>
      createObservation({
        id: OBSERVATION_ID,
        gardenId: GARDEN_ID,
        plantId: null,
        gardenObjectId: null,
        actorProfileId: PROFILE_ID,
        rawNoteText: null,
        rawConditionSummary: null,
        observedAt: OBSERVED_AT,
        photoCount: 0,
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects note/summary text that is blank only after trimming, the same as absent', () => {
    expect(() =>
      createObservation({
        id: OBSERVATION_ID,
        gardenId: GARDEN_ID,
        plantId: null,
        gardenObjectId: null,
        actorProfileId: PROFILE_ID,
        rawNoteText: '   ',
        rawConditionSummary: '   ',
        observedAt: OBSERVED_AT,
        photoCount: 0,
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});

describe('createCorrectionObservation', () => {
  const original = createObservation({
    id: OBSERVATION_ID,
    gardenId: GARDEN_ID,
    plantId: PLANT_ID,
    gardenObjectId: null,
    actorProfileId: PROFILE_ID,
    rawNoteText: 'Leaves look wilted.',
    rawConditionSummary: null,
    observedAt: OBSERVED_AT,
    photoCount: 0,
    now: NOW,
  });

  it('copies gardenId/plantId/gardenObjectId from the original and points backward to it, leaving the original object untouched', () => {
    const originalSnapshot = { ...original };
    const correctionId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a06';
    const correctedAt = new Date('2026-07-22T09:00:00Z');

    const correction = createCorrectionObservation({
      id: correctionId,
      original,
      correctionKind: 'amendment',
      actorProfileId: PROFILE_ID,
      rawNoteText: 'Leaves recovered after watering.',
      rawConditionSummary: null,
      observedAt: correctedAt,
      photoCount: 0,
      now: correctedAt,
    });

    expect(correction).toEqual({
      id: correctionId,
      gardenId: original.gardenId,
      plantId: original.plantId,
      gardenObjectId: original.gardenObjectId,
      actorType: 'user',
      createdByProfileId: PROFILE_ID,
      noteText: 'Leaves recovered after watering.',
      conditionSummary: null,
      correctionKind: 'amendment',
      correctsObservationId: original.id,
      observedAt: correctedAt,
      recordedAt: correctedAt,
    });
    // The original passed in is a plain object this function only reads —
    // asserting it is unchanged is what proves createCorrectionObservation
    // never mutates it.
    expect(original).toEqual(originalSnapshot);
  });

  it('supports the supersede correction kind', () => {
    const correction = createCorrectionObservation({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a07',
      original,
      correctionKind: 'supersede',
      actorProfileId: PROFILE_ID,
      rawNoteText: 'Corrected: this was actually a different plant.',
      rawConditionSummary: null,
      observedAt: NOW,
      photoCount: 0,
      now: NOW,
    });

    expect(correction.correctionKind).toBe('supersede');
    expect(correction.correctsObservationId).toBe(original.id);
  });

  it('rejects a correction with no note, no summary, and no photos, the same as a fresh observation', () => {
    expect(() =>
      createCorrectionObservation({
        id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a08',
        original,
        correctionKind: 'amendment',
        actorProfileId: PROFILE_ID,
        rawNoteText: null,
        rawConditionSummary: null,
        observedAt: NOW,
        photoCount: 0,
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});

describe('requireObservationContent', () => {
  it('does not throw when at least one of note, summary, or photoCount is present', () => {
    expect(() => requireObservationContent('note', null, 0)).not.toThrow();
    expect(() => requireObservationContent(null, 'summary', 0)).not.toThrow();
    expect(() => requireObservationContent(null, null, 1)).not.toThrow();
  });

  it('throws a ValidationError with an observation-specific detail when all three are absent', () => {
    try {
      requireObservationContent(null, null, 0);
      expect.unreachable('requireObservationContent did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual([
        { code: 'observation.content.empty', pointer: '/noteText' },
      ]);
    }
  });
});
