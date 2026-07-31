import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  GARDEN_ID,
  NOTE_ONLY_INPUT,
  NOW,
  PROFILE_ID,
  buildHarness,
} from './record-observation-test-support.js';

describe('RecordObservation — measurements, phenology, and context snapshot (P11-MEDIA-01)', () => {
  it('records measurements, one row per kind', async () => {
    const { recordObservation } = buildHarness({});

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      {
        ...NOTE_ONLY_INPUT,
        measurements: [
          { kind: 'height', value: 30, unit: 'cm' },
          { kind: 'count', value: 3, unit: 'count' },
        ],
      },
      randomUUID(),
    );

    expect(resource.measurements).toHaveLength(2);
    expect(resource.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'height', value: 30, unit: 'cm' }),
        expect.objectContaining({ kind: 'count', value: 3, unit: 'count' }),
      ]),
    );
  });

  it('rejects an invalid measurement, inserting nothing', async () => {
    const { recordObservation, observations } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, measurements: [{ kind: 'height', value: -1, unit: 'cm' }] },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(observations.rows).toHaveLength(1);
  });

  it('records the reported phenological stage', async () => {
    const { recordObservation } = buildHarness({});

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      { ...NOTE_ONLY_INPUT, observedPhenologicalStage: 'flowering' },
      randomUUID(),
    );

    expect(resource.observedPhenologicalStage).toBe('flowering');
  });

  it('rejects an unrecognized phenological stage', async () => {
    const { recordObservation } = buildHarness({});

    await expect(
      recordObservation.execute(
        GARDEN_ID,
        PROFILE_ID,
        { ...NOTE_ONLY_INPUT, observedPhenologicalStage: 'dormant' },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("snapshots the garden's currently declared context facts onto the observation", async () => {
    const { recordObservation } = buildHarness({
      contextFacts: [
        {
          id: randomUUID(),
          gardenId: GARDEN_ID,
          contextKind: 'sun_exposure',
          value: 'full_sun',
          source: 'user_declared',
          recordedByProfileId: PROFILE_ID,
          recordedAt: NOW,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });

    const resource = await recordObservation.execute(
      GARDEN_ID,
      PROFILE_ID,
      NOTE_ONLY_INPUT,
      randomUUID(),
    );

    expect(resource.observedSunExposure).toBe('full_sun');
    expect(resource.observedDrainage).toBeNull();
    expect(resource.observedGrowingContext).toBeNull();
  });
});
