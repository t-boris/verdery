import { describe, expect, it } from 'vitest';
import { derivativeProfileFor, planTilePyramid, TILE_SIZE_PX } from './derivative-profile.js';

describe('derivativeProfileFor', () => {
  it('builds a thumbnail and screen preview for garden_photo, no tile pyramid', () => {
    const profile = derivativeProfileFor('garden_photo');
    expect(profile?.includeTilePyramid).toBe(false);
    expect(profile?.rasterSpecs.map((spec) => spec.kind)).toEqual(['thumbnail', 'screen_preview']);
  });

  it('builds a thumbnail, screen preview, high-resolution image, and a tile pyramid for imported_plan', () => {
    const profile = derivativeProfileFor('imported_plan');
    expect(profile?.includeTilePyramid).toBe(true);
    expect(profile?.rasterSpecs.map((spec) => spec.kind)).toEqual([
      'thumbnail',
      'screen_preview',
      'high_resolution',
    ]);
  });

  it('never upscales — every spec is bounded by maxDimensionPx only, no minimum', () => {
    const profile = derivativeProfileFor('imported_plan');
    for (const spec of profile?.rasterSpecs ?? []) {
      expect(spec.maxDimensionPx).toBeGreaterThan(0);
      expect(spec.jpegQuality).toBeGreaterThan(0);
      expect(spec.jpegQuality).toBeLessThanOrEqual(100);
    }
  });

  it('is null for raw_capture, derived_preview, processing_output, export_package, and an unrecognized class', () => {
    for (const mediaClass of [
      'raw_capture',
      'derived_preview',
      'processing_output',
      'export_package',
      'something_unrecognized',
    ]) {
      expect(derivativeProfileFor(mediaClass)).toBeNull();
    }
  });
});

describe('planTilePyramid', () => {
  it('a source smaller than one tile produces exactly one level, one tile', () => {
    const levels = planTilePyramid(100, 80);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ zoomLevel: 0, tilesX: 1, tilesY: 1 });
  });

  it('a source exactly one tile square produces exactly one level', () => {
    const levels = planTilePyramid(TILE_SIZE_PX, TILE_SIZE_PX);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ zoomLevel: 0, tilesX: 1, tilesY: 1 });
  });

  it('a source 2x the tile size produces two levels: 1 tile at z0, 4 tiles at z1 (2x2)', () => {
    const size = TILE_SIZE_PX * 2;
    const levels = planTilePyramid(size, size);

    expect(levels.map((level) => level.zoomLevel)).toEqual([1, 0]);
    const z0 = levels.find((level) => level.zoomLevel === 0);
    const z1 = levels.find((level) => level.zoomLevel === 1);
    expect(z0).toMatchObject({ tilesX: 1, tilesY: 1 });
    expect(z1).toMatchObject({ tilesX: 2, tilesY: 2 });
  });

  it('tile count doubles per level going up in zoom (the standard image-pyramid doubling relationship)', () => {
    const size = TILE_SIZE_PX * 16; // 16x -> maxZoomLevel = log2(16) = 4
    const levels = planTilePyramid(size, size);

    expect(levels.map((level) => level.zoomLevel)).toEqual([4, 3, 2, 1, 0]);
    for (const level of levels) {
      const expectedTilesPerAxis = 2 ** level.zoomLevel;
      expect(level.tilesX).toBe(expectedTilesPerAxis);
      expect(level.tilesY).toBe(expectedTilesPerAxis);
    }
  });

  it('the deepest level (maxZoomLevel) always covers the full native resolution', () => {
    const levels = planTilePyramid(1_000, 700);
    const deepest = levels[0];
    expect(deepest?.scaledWidth).toBe(1_000);
    expect(deepest?.scaledHeight).toBe(700);
  });

  it('a non-square, non-power-of-two source still terminates at exactly one tile at zoom 0', () => {
    const levels = planTilePyramid(3_000, 1_100);
    const z0 = levels[levels.length - 1];
    expect(z0?.zoomLevel).toBe(0);
    expect(z0?.tilesX).toBe(1);
    expect(z0?.tilesY).toBe(1);
    expect(z0?.scaledWidth).toBeLessThanOrEqual(TILE_SIZE_PX);
    expect(z0?.scaledHeight).toBeLessThanOrEqual(TILE_SIZE_PX);
  });
});
