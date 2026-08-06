import { describe, expect, it } from 'vitest';

import {
  insertProposalVertex,
  moveProposalVertex,
  removeProposalVertex,
  translateProposalGeometry,
} from './aerial-proposal-geometry';

describe('aerial proposal editing', () => {
  it('moves a polygon closure vertex at both stored ends', () => {
    const geometry = moveProposalVertex(
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
        ],
      },
      0,
      [1, 1],
    );

    expect(geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [1, 1],
          [2, 0],
          [2, 2],
          [1, 1],
        ],
      ],
    });
  });

  it('inserts, removes, and translates line vertices deterministically', () => {
    const inserted = insertProposalVertex(
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [2, 0],
        ],
      },
      1,
      [1, 1],
    );
    const removed = removeProposalVertex(inserted, 1);

    expect(removed).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [2, 0],
      ],
    });
    expect(translateProposalGeometry(removed, 3, -2)).toEqual({
      type: 'LineString',
      coordinates: [
        [3, -2],
        [5, -2],
      ],
    });
  });
});
