/**
 * Renders the XYZ tile pyramid `derivative-profile.ts`'s `planTilePyramid`
 * plans, from the same already-oriented, already-metadata-stripped
 * intermediate `image-derivative-generator.ts`'s `decodeAndOrient` produces.
 *
 * PNG, not JPEG, for tile output: an edge tile at the pyramid's boundary (a
 * level whose scaled dimensions are not an exact multiple of `TILE_SIZE_PX`)
 * is padded out to a full square tile with a transparent margin, since
 * MapLibre's XYZ raster source expects uniform tile dimensions — JPEG has no
 * alpha channel to pad with. Every tile within a level's own visible bounds
 * is real image content; only the trailing margin of a boundary tile is
 * transparent padding.
 */

import sharp from 'sharp';
import type { TileLevelPlan } from './derivative-profile.js';
import { TILE_SIZE_PX } from './derivative-profile.js';
import type { OrientedSourceImage } from './image-derivative-generator.js';

export interface GeneratedTile {
  readonly zoomLevel: number;
  readonly x: number;
  readonly y: number;
  readonly buffer: Buffer;
  readonly contentType: string;
}

const PNG_CONTENT_TYPE = 'image/png';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export async function generateTilePyramid(
  source: OrientedSourceImage,
  levels: readonly TileLevelPlan[],
): Promise<readonly GeneratedTile[]> {
  const tiles: GeneratedTile[] = [];

  for (const level of levels) {
    // One resize per level, re-tiled below — simpler than caching level
    // buffers keyed by dimension for a marginal gain; source images are
    // already bounded by media_validation's own 40-megapixel/16,384px-per-
    // axis ceiling, so this stays fast in practice.
    const levelBuffer = await sharp(source.buffer)
      .resize({ width: level.scaledWidth, height: level.scaledHeight, fit: 'fill' })
      .png()
      .toBuffer();

    for (let y = 0; y < level.tilesY; y += 1) {
      for (let x = 0; x < level.tilesX; x += 1) {
        const left = x * TILE_SIZE_PX;
        const top = y * TILE_SIZE_PX;
        const width = Math.min(TILE_SIZE_PX, level.scaledWidth - left);
        const height = Math.min(TILE_SIZE_PX, level.scaledHeight - top);

        const tileBuffer = await sharp(levelBuffer)
          .extract({ left, top, width, height })
          .extend({
            top: 0,
            left: 0,
            bottom: TILE_SIZE_PX - height,
            right: TILE_SIZE_PX - width,
            background: TRANSPARENT,
          })
          .png()
          .toBuffer();

        tiles.push({
          zoomLevel: level.zoomLevel,
          x,
          y,
          buffer: tileBuffer,
          contentType: PNG_CONTENT_TYPE,
        });
      }
    }
  }

  return tiles;
}
