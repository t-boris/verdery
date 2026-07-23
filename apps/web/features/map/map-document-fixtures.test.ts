/**
 * P3-QA-01: cross-platform semantic comparison of whole garden-map documents.
 *
 * `packages/test-fixtures/fixtures/geometry/map-documents.json` carries five
 * scenarios — small, ordinary, large, pathological, and accessibility — each
 * a set of wire-shaped `GardenObject` entries plus the projection both this
 * app and the iOS app are expected to derive from them
 * (`apps/ios/Tests/CoreNetworkingTests/MapDocumentFixtureTests.swift` runs
 * the identical fixture through the Swift decode path). Passing on both
 * platforms is the actual cross-platform equivalence proof; this file only
 * covers the web half.
 */

import { positionsOf } from '@verdery/geometry-contracts';
import type { MapDocumentFixture, MapDocumentObjectProjection } from '@verdery/test-fixtures';
import { loadFixture } from '@verdery/test-fixtures';
import { describe, expect, it } from 'vitest';

import type { WireGardenObject } from '@/core/api/public';

import { toMapObjectRecord } from './object-mapper';

const fixture = loadFixture<MapDocumentFixture>('geometry/map-documents.json');

function project(wire: WireGardenObject): MapDocumentObjectProjection {
  const record = toMapObjectRecord(wire);

  return {
    id: record.id,
    category: record.category,
    geometryType: record.geometry.type,
    coordinateCount: positionsOf(record.geometry).length,
    label: record.label ?? null,
    lifecycleState: record.lifecycleState,
    detailsCategory: record.categoryDetails?.category ?? null,
    // A generic Record spread cannot prove which GardenObjectDetails branch
    // a runtime `category` selects — same reasoning as `fromWireCategoryDetails`
    // in `core/api/map-wire-types.ts`, the one place this codebase already
    // makes this exact cast.
    detailsFields: (record.categoryDetails?.details as Record<string, unknown> | undefined) ?? null,
  };
}

describe('map document fixtures', () => {
  it('covers every garden object category at least once', () => {
    const categories = new Set(
      fixture.cases.flatMap((testCase) =>
        testCase.objects.map((wire) => (wire as WireGardenObject).category),
      ),
    );

    expect(categories.size).toBe(13);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    '%s: decodes every object to the expected projection',
    (_name, testCase) => {
      const projections = testCase.objects.map((wire) => project(wire as WireGardenObject));
      expect(projections).toEqual(testCase.expected);
    },
  );
});
