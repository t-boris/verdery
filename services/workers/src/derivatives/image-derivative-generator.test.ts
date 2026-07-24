/**
 * Real `sharp`-decode coverage: EXIF orientation actually rotates pixel
 * content (not just a metadata flag), EXIF metadata (GPS location included)
 * is genuinely absent from the produced buffer, and resizing never upscales
 * a smaller source.
 *
 * `sharp` is now a real `services/workers` production dependency (moved
 * from `devDependencies` — see `package.json`'s own diff and this stage's
 * report) — used here exactly as P6-WORKER-01's own `media-validator.test.ts`
 * already used it as a devDependency, to fabricate real, valid fixtures.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeAndOrient, resizeRasterDerivative } from './image-derivative-generator.js';

let workDirectory: string;
beforeEach(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'verdery-derivative-test-'));
});
afterEach(async () => {
  await rm(workDirectory, { recursive: true, force: true });
});

async function writeFixture(buffer: Buffer): Promise<string> {
  const path = join(workDirectory, 'source');
  await writeFile(path, buffer);
  return path;
}

/** 8x4, top row red, everything else blue, GPS location + EXIF Orientation 6 ("rotate 90° CW to display correctly") — see this file's own header comment on why the fixture is built this way. */
async function orientedGpsTaggedFixture(): Promise<Buffer> {
  const width = 8;
  const height = 4;
  const raw = Buffer.alloc(width * height * 3, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      if (y === 0) {
        raw[index] = 255; // red top row
      } else {
        raw[index + 2] = 255; // blue everywhere else
      }
    }
  }

  return sharp(raw, { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Copyright: 'test-fixture' },
      // Sharp's own documented GPS example (output.js): the GPS sub-IFD is
      // IFD3, not "GPSInfo" — verified empirically against this exact sharp
      // version (0.34.5) before writing this fixture: the encoded EXIF
      // bytes contain the little-endian byte pair for tag 0x8825 (the GPS
      // IFD pointer IFD0 itself carries), confirming a real GPS sub-IFD is
      // actually written, not silently dropped.
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '37/1 46/1 30/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '122/1 25/1 10/1',
      },
    })
    .png()
    .toBuffer();
}

describe('decodeAndOrient', () => {
  it('the fixture itself genuinely carries a GPS EXIF tag (sanity check on the fixture, not the code under test)', async () => {
    const fixture = await orientedGpsTaggedFixture();
    const metadata = await sharp(fixture).metadata();

    expect(metadata.orientation).toBe(6);
    expect(metadata.exif).toBeDefined();
    // Tag 0x8825 (GPS IFD pointer), little-endian byte order, as an
    // unambiguous marker that a real GPS sub-IFD was written — see the
    // fixture builder's own comment.
    expect(metadata.exif?.toString('hex')).toContain('2588');
  });

  it('rotates pixel content according to the real EXIF Orientation tag (top row becomes the right column for orientation 6), and swaps width/height', async () => {
    const fixture = await orientedGpsTaggedFixture();
    const path = await writeFixture(fixture);

    const oriented = await decodeAndOrient(path);

    // 8x4 source -> 4x8 after a 90° rotation.
    expect(oriented.width).toBe(4);
    expect(oriented.height).toBe(8);

    const { data, info } = await sharp(oriented.buffer).raw().toBuffer({ resolveWithObject: true });
    function pixelAt(x: number, y: number): [number, number, number] {
      const index = (y * info.width + x) * info.channels;
      return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
    }

    expect(pixelAt(0, 0)).toEqual([0, 0, 255]); // left column: blue
    expect(pixelAt(0, info.height - 1)).toEqual([0, 0, 255]);
    expect(pixelAt(info.width - 1, 0)).toEqual([255, 0, 0]); // right column: red (was the top row)
    expect(pixelAt(info.width - 1, info.height - 1)).toEqual([255, 0, 0]);
  });

  it('strips EXIF (including GPS) unconditionally — the oriented buffer carries no metadata at all', async () => {
    const fixture = await orientedGpsTaggedFixture();
    const path = await writeFixture(fixture);

    const oriented = await decodeAndOrient(path);

    const metadata = await sharp(oriented.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it('a source with no EXIF orientation tag at all (orientation 1, the common case) passes through unrotated', async () => {
    const plain = await sharp({
      create: { width: 6, height: 4, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    const path = await writeFixture(plain);

    const oriented = await decodeAndOrient(path);

    expect(oriented.width).toBe(6);
    expect(oriented.height).toBe(4);
  });
});

describe('resizeRasterDerivative', () => {
  it('resizes to fit within maxDimensionPx on the long edge, preserving aspect ratio, and encodes JPEG', async () => {
    const plain = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    const source = await decodeAndOrient(await writeFixture(plain));

    const thumbnail = await resizeRasterDerivative(source, 100, 80);

    expect(thumbnail.contentType).toBe('image/jpeg');
    expect(thumbnail.width).toBe(100);
    expect(thumbnail.height).toBe(50); // aspect ratio preserved: 400x200 -> 100x50
  });

  it('never upscales a source already smaller than maxDimensionPx', async () => {
    const plain = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    const source = await decodeAndOrient(await writeFixture(plain));

    const result = await resizeRasterDerivative(source, 1_600, 82);

    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
  });
});
