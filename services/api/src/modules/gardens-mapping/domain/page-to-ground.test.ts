import { describe, expect, it } from 'vitest';

import {
  applyPageToGround,
  fitPageToGround,
  outlineToGround,
  type PagePoint,
} from './page-to-ground.js';

/** A square lot, 30 m on a side, as the survey knows it. */
const GROUND_SQUARE = [
  [0, 0],
  [30, 0],
  [30, 30],
  [0, 30],
] as const;

/**
 * The same square as a model outlines it on the page: a tenth of the sheet
 * per side, near the middle, y growing downward the way an image does.
 */
const PAGE_SQUARE: PagePoint[] = [
  [0.4, 0.6],
  [0.5, 0.6],
  [0.5, 0.5],
  [0.4, 0.5],
];

describe('fitPageToGround', () => {
  it('refuses rings that do not describe the same corners', () => {
    expect(fitPageToGround([], GROUND_SQUARE)).toBeNull();
    expect(fitPageToGround(PAGE_SQUARE, GROUND_SQUARE.slice(0, 3))).toBeNull();
  });

  it('refuses a page outline with no extent to scale from', () => {
    const degenerate: PagePoint[] = [
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ];

    expect(fitPageToGround(degenerate, GROUND_SQUARE.slice(0, 3))).toBeNull();
  });

  /*
   * The scale comes from the SURVEY, never from the model: a tenth of the
   * page is thirty metres because the boundary calls say the lot is thirty
   * metres, so one page unit is three hundred.
   */
  it('takes its scale from the surveyed lot', () => {
    const transform = fitPageToGround(PAGE_SQUARE, GROUND_SQUARE);

    expect(transform).not.toBeNull();
    expect(transform?.scale).toBeCloseTo(300, 6);
    expect(transform?.residualMetres ?? 1).toBeLessThan(0.001);
  });

  it('carries the lot’s own corners back onto the surveyed ones', () => {
    const transform = fitPageToGround(PAGE_SQUARE, GROUND_SQUARE);
    if (transform === null) throw new Error('expected a transform');

    for (let index = 0; index < PAGE_SQUARE.length; index += 1) {
      const carried = applyPageToGround(PAGE_SQUARE[index] ?? [0, 0], transform);
      const expected = GROUND_SQUARE[index] ?? [0, 0];
      expect(carried[0]).toBeCloseTo(expected[0], 3);
      expect(carried[1]).toBeCloseTo(expected[1], 3);
    }
  });

  /*
   * The whole reason this exists: a house outlined on the page lands in real
   * metres, at the survey's scale, without the model ever stating a
   * dimension. Here the house covers a quarter of the lot's width in the
   * page, so it must be 7.5 m across on the ground.
   */
  it('carries a house outlined on the page into real metres', () => {
    const transform = fitPageToGround(PAGE_SQUARE, GROUND_SQUARE);
    if (transform === null) throw new Error('expected a transform');

    const house: PagePoint[] = [
      [0.42, 0.58],
      [0.445, 0.58],
      [0.445, 0.555],
      [0.42, 0.555],
    ];
    const ground = outlineToGround(house, transform);

    expect(ground).not.toBeNull();
    expect(ground).toHaveLength(5);
    const width = Math.hypot(
      (ground?.[1]?.[0] ?? 0) - (ground?.[0]?.[0] ?? 0),
      (ground?.[1]?.[1] ?? 0) - (ground?.[0]?.[1] ?? 0),
    );
    expect(width).toBeCloseTo(7.5, 2);
  });

  /*
   * A rotated drawing is the normal case — a plat is drawn with the lot at
   * whatever angle fits the sheet, not axis-aligned. The fit recovers the
   * rotation, so nothing downstream has to know the page's orientation.
   */
  it('recovers a rotated drawing', () => {
    const angle = Math.PI / 6;
    const rotatedGround = GROUND_SQUARE.map(
      ([x, y]) =>
        [
          x * Math.cos(angle) - y * Math.sin(angle),
          x * Math.sin(angle) + y * Math.cos(angle),
        ] as const,
    );

    const transform = fitPageToGround(PAGE_SQUARE, rotatedGround);

    expect(transform?.scale).toBeCloseTo(300, 6);
    expect(transform?.residualMetres ?? 1).toBeLessThan(0.001);
  });

  /*
   * The check that keeps a bad reading visible: a page outline that is not
   * the surveyed shape cannot be stretched into agreement, because a
   * similarity has no shear. The residual says so.
   */
  it('reports a residual when the page outline is not the surveyed shape', () => {
    const skewed: PagePoint[] = [
      [0.4, 0.6],
      [0.5, 0.6],
      [0.5, 0.4],
      [0.4, 0.5],
    ];

    const transform = fitPageToGround(skewed, GROUND_SQUARE);

    expect(transform?.residualMetres ?? 0).toBeGreaterThan(1);
  });

  it('tolerates a ring that repeats its first point at the end', () => {
    const closed: PagePoint[] = [...PAGE_SQUARE, PAGE_SQUARE[0] ?? [0, 0]];

    expect(fitPageToGround(closed, GROUND_SQUARE)?.scale).toBeCloseTo(300, 6);
  });
});
