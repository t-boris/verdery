import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TILE_SIZE_PX, planTilePyramid } from './derivative-profile.js';
import { decodeAndOrient } from './image-derivative-generator.js';
import { generateTilePyramid } from './tile-pyramid-generator.js';

async function orientedFixture(width: number, height: number) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
  const directory = await mkdtemp(join(tmpdir(), 'verdery-tile-test-'));
  const path = join(directory, 'source.png');
  await writeFile(path, buffer);
  return decodeAndOrient(path);
}

describe('generateTilePyramid', () => {
  it('produces exactly the tile count the plan describes, per level, addressed by real (zoomLevel, x, y)', async () => {
    const size = TILE_SIZE_PX * 2; // maxZoomLevel = 1: z1 = 2x2 (4 tiles), z0 = 1x1 (1 tile)
    const source = await orientedFixture(size, size);
    const levels = planTilePyramid(source.width, source.height);

    const tiles = await generateTilePyramid(source, levels);

    expect(tiles).toHaveLength(5); // 4 + 1
    for (const level of levels) {
      const tilesAtLevel = tiles.filter((tile) => tile.zoomLevel === level.zoomLevel);
      expect(tilesAtLevel).toHaveLength(level.tilesX * level.tilesY);
      // Every (x, y) coordinate within the level's own bounds is present
      // exactly once — real, internally consistent XYZ addressing.
      const coordinates = new Set(tilesAtLevel.map((tile) => `${tile.x},${tile.y}`));
      expect(coordinates.size).toBe(tilesAtLevel.length);
      for (let y = 0; y < level.tilesY; y += 1) {
        for (let x = 0; x < level.tilesX; x += 1) {
          expect(coordinates.has(`${x},${y}`)).toBe(true);
        }
      }
    }
  });

  it('every tile is a real, decodable PNG image of exactly TILE_SIZE_PX square', async () => {
    const source = await orientedFixture(TILE_SIZE_PX * 2, TILE_SIZE_PX);
    const levels = planTilePyramid(source.width, source.height);

    const tiles = await generateTilePyramid(source, levels);

    for (const tile of tiles) {
      expect(tile.contentType).toBe('image/png');
      const metadata = await sharp(tile.buffer).metadata();
      expect(metadata.width).toBe(TILE_SIZE_PX);
      expect(metadata.height).toBe(TILE_SIZE_PX);
      expect(metadata.format).toBe('png');
    }
  });

  it('a single-tile (level 0 only) source produces exactly one tile at (0, 0, 0)', async () => {
    const source = await orientedFixture(100, 60);
    const levels = planTilePyramid(source.width, source.height);

    const tiles = await generateTilePyramid(source, levels);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ zoomLevel: 0, x: 0, y: 0 });
  });
});
