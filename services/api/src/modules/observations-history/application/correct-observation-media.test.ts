import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AMENDMENT_INPUT,
  GARDEN_ID,
  NOW,
  PROFILE_ID,
  buildHarness,
} from './correct-observation-test-support.js';

describe('CorrectObservation — measurements and context snapshot (P11-MEDIA-01)', () => {
  it('records measurements on the new correction row', async () => {
    const { correctObservation, original } = buildHarness({});

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      { ...AMENDMENT_INPUT, measurements: [{ kind: 'width', value: 12, unit: 'cm' }] },
      randomUUID(),
    );

    expect(resource.measurements).toEqual([
      expect.objectContaining({ kind: 'width', value: 12, unit: 'cm' }),
    ]);
  });

  it("re-resolves the garden's context snapshot fresh at correction time, not from the original", async () => {
    const { correctObservation, original } = buildHarness({
      contextFacts: [
        {
          id: randomUUID(),
          gardenId: GARDEN_ID,
          contextKind: 'drainage',
          value: 'poor_drainage',
          source: 'user_declared',
          recordedByProfileId: PROFILE_ID,
          recordedAt: NOW,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });

    const resource = await correctObservation.execute(
      original.id,
      PROFILE_ID,
      AMENDMENT_INPUT,
      randomUUID(),
    );

    expect(resource.observedDrainage).toBe('poor_drainage');
    expect(original.observedDrainage).toBeNull();
  });
});
