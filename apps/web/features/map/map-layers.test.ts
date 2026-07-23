import type { GardenObjectCategory } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import {
  LAYER_IDS,
  isCategoryHidden,
  isCategoryLocked,
  isLayerHidden,
  isLayerLocked,
  layerForCategory,
} from './map-layers';

const ALL_CATEGORIES: readonly GardenObjectCategory[] = [
  'lot',
  'structure',
  'fence',
  'gate',
  'path',
  'zone',
  'bed',
  'waterFeature',
  'utilityExclusion',
  'tree',
  'plant',
  'annotation',
  'importedBackground',
];

describe('layerForCategory', () => {
  it('assigns every category to one of the four togglable layers', () => {
    for (const category of ALL_CATEGORIES) {
      expect(LAYER_IDS).toContain(layerForCategory(category));
    }
  });

  it('assigns lot and structure to layer 3', () => {
    expect(layerForCategory('lot')).toBe(3);
    expect(layerForCategory('structure')).toBe(3);
  });

  it('assigns zone, bed, path, fence, and gate to layer 4', () => {
    expect(layerForCategory('zone')).toBe(4);
    expect(layerForCategory('bed')).toBe(4);
    expect(layerForCategory('path')).toBe(4);
    expect(layerForCategory('fence')).toBe(4);
    expect(layerForCategory('gate')).toBe(4);
  });

  it('assigns utilityExclusion and waterFeature to layer 4, alongside zones and beds', () => {
    expect(layerForCategory('utilityExclusion')).toBe(4);
    expect(layerForCategory('waterFeature')).toBe(4);
  });

  it('assigns tree, plant, and annotation to layer 5', () => {
    expect(layerForCategory('tree')).toBe(5);
    expect(layerForCategory('plant')).toBe(5);
    expect(layerForCategory('annotation')).toBe(5);
  });

  it('assigns importedBackground to layer 2', () => {
    expect(layerForCategory('importedBackground')).toBe(2);
  });
});

describe('isLayerHidden / isLayerLocked', () => {
  it('is false for an empty list and true once the layer is included', () => {
    expect(isLayerHidden(3, [])).toBe(false);
    expect(isLayerHidden(3, [3])).toBe(true);
    expect(isLayerHidden(3, [4])).toBe(false);

    expect(isLayerLocked(4, [])).toBe(false);
    expect(isLayerLocked(4, [4])).toBe(true);
    expect(isLayerLocked(4, [3])).toBe(false);
  });
});

describe('isCategoryHidden / isCategoryLocked', () => {
  it('resolves through layerForCategory before checking membership', () => {
    expect(isCategoryHidden('plant', [5])).toBe(true);
    expect(isCategoryHidden('plant', [4])).toBe(false);
    expect(isCategoryLocked('fence', [4])).toBe(true);
    expect(isCategoryLocked('fence', [5])).toBe(false);
  });
});
