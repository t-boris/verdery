/**
 * P11-MEDIA-01's request parsing: the journal-frame sequence's query, and the
 * one-row-per-measurement-kind rule the observation body must satisfy. Pure
 * input validation, so it is tested here rather than through the HTTP suite —
 * `tests/http/observation-routes.test.ts` needs a real migrated database for
 * what it covers, and none of these cases needs one.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { ListPlantJournalFrames } from '../application/list-plant-journal-frames.js';
import {
  parseCorrectObservationRequest,
  parseJournalFramesQuery,
  parseRecordObservationRequest,
} from './parse-observation-request.js';

describe('parseJournalFramesQuery', () => {
  it('returns an unnarrowed sequence at the full bound when the query is empty', () => {
    // An unnarrowed sequence is the one case that includes photographs with no
    // purpose label at all — see the repository read's own reasoning.
    expect(parseJournalFramesQuery({})).toEqual({
      purpose: null,
      limit: ListPlantJournalFrames.MAX_FRAMES,
    });
  });

  it('narrows to a purpose the domain actually defines', () => {
    expect(parseJournalFramesQuery({ purpose: 'leaf_front' }).purpose).toBe('leaf_front');
  });

  // Refused, never ignored: a misspelled purpose that fell through to "no
  // narrowing" would return an incomparable mixture of whole-plant shots and
  // close-ups as if it were the sequence the caller asked for.
  it.each(['leaf', 'LEAF_FRONT', '', 42, null])('rejects %o as a purpose', (value) => {
    expect(() => parseJournalFramesQuery({ purpose: value })).toThrow(ValidationError);
  });

  it('accepts a limit inside the bound, as the string a query parameter always is', () => {
    expect(parseJournalFramesQuery({ limit: '12' }).limit).toBe(12);
  });

  it('accepts the bound itself', () => {
    expect(
      parseJournalFramesQuery({ limit: String(ListPlantJournalFrames.MAX_FRAMES) }).limit,
    ).toBe(ListPlantJournalFrames.MAX_FRAMES);
  });

  // `Number('')` is 0 and `Number('  ')` is 0, so an empty limit reaches the
  // range check rather than the type check — either way it is refused, instead
  // of silently becoming "every frame".
  it.each(['0', '-1', '1.5', '201', '', 'all'])('rejects %o as a limit', (value) => {
    expect(() => parseJournalFramesQuery({ limit: value })).toThrow(ValidationError);
  });

  it('treats an absent query object the same as an empty one', () => {
    // Fastify supplies `{}` for a query-less request, but the parser takes
    // `unknown` and must not throw on `undefined` the way property access on
    // it would.
    expect(parseJournalFramesQuery(undefined)).toEqual({
      purpose: null,
      limit: ListPlantJournalFrames.MAX_FRAMES,
    });
  });
});

describe('parseRecordObservationRequest — measurements', () => {
  it('accepts one measurement of each kind', () => {
    const parsed = parseRecordObservationRequest({
      noteText: 'Note',
      measurements: [
        { kind: 'height', value: 40, unit: 'cm' },
        { kind: 'width', value: 25, unit: 'cm' },
      ],
    });

    expect(parsed.measurements).toHaveLength(2);
  });

  it('refuses a second measurement of a kind already present', () => {
    // `observation_measurement_unique_kind` permits one row per kind. Without
    // this check the insert reaches that constraint mid-transaction, where a
    // client mistake surfaces as a 500 with nothing naming the cause.
    expect(() =>
      parseRecordObservationRequest({
        noteText: 'Note',
        measurements: [
          { kind: 'height', value: 40, unit: 'cm' },
          { kind: 'height', value: 41, unit: 'cm' },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it('refuses a second entry for a symptom already reported', () => {
    // `observation_symptom_unique_kind`: one statement per symptom per
    // observation, the same shape the measurement rule has.
    expect(() =>
      parseRecordObservationRequest({
        noteText: 'Note',
        symptoms: [
          { kind: 'leaf_spots', severity: 'mild' },
          { kind: 'leaf_spots', severity: 'severe' },
        ],
      }),
    ).toThrow(ValidationError);
  });

  it('accepts different symptoms on one observation', () => {
    const parsed = parseRecordObservationRequest({
      noteText: 'Note',
      symptoms: [
        { kind: 'leaf_spots', severity: 'mild' },
        { kind: 'wilting', severity: 'severe' },
      ],
    });

    expect(parsed.symptoms).toHaveLength(2);
  });

  it('applies the same rule to a correction, which writes the same table', () => {
    expect(() =>
      parseCorrectObservationRequest({
        correctionKind: 'amendment',
        measurements: [
          { kind: 'count', value: 3, unit: 'pcs' },
          { kind: 'count', value: 4, unit: 'pcs' },
        ],
      }),
    ).toThrow(ValidationError);
  });
});
