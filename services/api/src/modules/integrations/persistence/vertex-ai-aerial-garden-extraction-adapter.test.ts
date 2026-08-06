import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { parseAerialTraceResponse } from './vertex-ai-aerial-garden-extraction-adapter.js';

function responseWith(value: unknown): GenerateContentResponse {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(value) }] } }],
  } as GenerateContentResponse;
}

describe('parseAerialTraceResponse', () => {
  it('accepts category-compatible normalized proposals', () => {
    expect(
      parseAerialTraceResponse(
        responseWith({
          objects: [
            {
              category: 'structure',
              label: 'House',
              points: [
                [0.2, 0.2],
                [0.4, 0.2],
                [0.4, 0.4],
              ],
              confidence: 0.91,
              limitations: ['North corner is shadowed.'],
              boundaryEvidence: 'notApplicable',
            },
            {
              category: 'tree',
              label: 'Tree',
              points: [[0.7, 0.8]],
              confidence: 0.73,
              limitations: [],
              boundaryEvidence: 'notApplicable',
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'extracted' });
  });

  it('rejects polygons used for trees and authoritative boundary claims', () => {
    expect(
      parseAerialTraceResponse(
        responseWith({
          objects: [
            {
              category: 'tree',
              label: 'Tree',
              points: [
                [0.1, 0.1],
                [0.2, 0.2],
              ],
              confidence: 0.8,
              limitations: [],
              boundaryEvidence: 'notApplicable',
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'schemaInvalid' });

    expect(
      parseAerialTraceResponse(
        responseWith({
          objects: [
            {
              category: 'lot',
              label: 'Lot',
              points: [
                [0.1, 0.1],
                [0.9, 0.1],
                [0.9, 0.9],
              ],
              confidence: 0.8,
              limitations: ['Approximate only.'],
              boundaryEvidence: 'authoritativeParcel',
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'schemaInvalid' });
  });

  it('returns a typed empty outcome instead of inventing objects', () => {
    expect(parseAerialTraceResponse(responseWith({ objects: [] }))).toEqual({
      kind: 'noVisibleGeometry',
    });
  });
});
