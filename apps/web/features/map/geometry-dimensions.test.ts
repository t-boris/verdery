import { describe, expect, it } from 'vitest';

import {
  dimensionsOfGeometry,
  resizeAreaGeometry,
  resizeLineGeometry,
} from './geometry-dimensions';

describe('dimensionsOfGeometry', () => {
  it('derives width, depth, area, and perimeter for a polygon', () => {
    expect(
      dimensionsOfGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
            [0, 0],
          ],
        ],
      }),
    ).toEqual({
      kind: 'area',
      widthMetres: 4,
      depthMetres: 3,
      areaSquareMetres: 12,
      perimeterMetres: 14,
    });
  });

  it('subtracts polygon holes from area while retaining their perimeter', () => {
    const dimensions = dimensionsOfGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    });

    expect(dimensions).toMatchObject({ areaSquareMetres: 24, perimeterMetres: 24 });
  });

  it('adds every segment in a line', () => {
    expect(
      dimensionsOfGeometry({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [3, 0],
          [3, 4],
        ],
      }),
    ).toEqual({ kind: 'line', lengthMetres: 7 });
  });
});

describe('exact-size transforms', () => {
  it('resizes a polygon independently on the map axes', () => {
    const resized = resizeAreaGeometry(
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      6,
      4,
    );

    expect(resized).not.toBeNull();
    expect(dimensionsOfGeometry(resized!)).toMatchObject({
      widthMetres: 6,
      depthMetres: 4,
      areaSquareMetres: 24,
    });
  });

  it('resizes a line without changing its shape', () => {
    const resized = resizeLineGeometry(
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [3, 0],
          [3, 4],
        ],
      },
      14,
    );

    expect(resized).not.toBeNull();
    expect(dimensionsOfGeometry(resized!)).toEqual({ kind: 'line', lengthMetres: 14 });
  });

  it('rejects zero and non-finite dimensions', () => {
    const line = {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 0],
      ] as const,
    };
    expect(resizeLineGeometry(line, 0)).toBeNull();
    expect(resizeLineGeometry(line, Number.NaN)).toBeNull();
  });
});
