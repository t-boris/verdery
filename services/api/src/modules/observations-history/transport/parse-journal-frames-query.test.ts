/**
 * The journal-frame sequence's query parsing (P11-MEDIA-01). Pure input
 * validation, so it is tested here rather than through the HTTP suite —
 * `tests/http/observation-routes.test.ts` needs a real migrated database for
 * what it covers, and none of these cases needs one.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { ListPlantJournalFrames } from '../application/list-plant-journal-frames.js';
import { parseJournalFramesQuery } from './parse-observation-request.js';

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
