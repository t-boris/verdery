/**
 * Tests for the dHash that backs near-duplicate detection.
 *
 * These build real images with `sharp` rather than fixtures: the whole
 * claim under test is about what happens to real pixels when a photograph
 * is re-encoded or resized, which a hand-written byte fixture cannot show.
 */

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PERCEPTUAL_HASH_HEX_LENGTH,
  PERCEPTUAL_HASH_MATCH_THRESHOLD,
} from '@verdery/api-contracts';
import { computePerceptualHash, perceptualHashDistance } from './perceptual-hash.js';

/** A deterministic gradient-and-blocks image — structure a dHash can describe. */
async function gradientImage(width: number, height: number, seed: number): Promise<Buffer> {
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const value = (x * 255) / width;
      const block = ((x / 16) | 0) % 2 === ((y / 16) | 0) % 2 ? 60 : 0;
      pixels[offset] = Math.min(255, (value + block + seed) | 0);
      pixels[offset + 1] = Math.min(255, (value * 0.6 + block) | 0);
      pixels[offset + 2] = Math.min(255, (255 - value + block) | 0);
    }
  }
  return sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
}

describe('computePerceptualHash', () => {
  it('renders sixteen lowercase hex characters', async () => {
    const hash = await computePerceptualHash(await gradientImage(128, 128, 0));

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toHaveLength(PERCEPTUAL_HASH_HEX_LENGTH);
  });

  it('survives re-encoding to a lossy format', async () => {
    // The case SHA-256 cannot see: same picture, different bytes.
    const source = await gradientImage(256, 256, 0);
    const reEncoded = await sharp(source).jpeg({ quality: 70 }).toBuffer();

    const [a, b] = await Promise.all([
      computePerceptualHash(source),
      computePerceptualHash(reEncoded),
    ]);

    expect(perceptualHashDistance(a!, b!)).toBeLessThanOrEqual(PERCEPTUAL_HASH_MATCH_THRESHOLD);
  });

  it('survives a resize', async () => {
    const source = await gradientImage(256, 256, 0);
    const resized = await sharp(source).resize(96, 96).png().toBuffer();

    const [a, b] = await Promise.all([
      computePerceptualHash(source),
      computePerceptualHash(resized),
    ]);

    expect(perceptualHashDistance(a!, b!)).toBeLessThanOrEqual(PERCEPTUAL_HASH_MATCH_THRESHOLD);
  });

  it('separates two different pictures by more than the threshold', async () => {
    // Without this the hash would "match" everything and the warning would
    // be noise a user learns to dismiss.
    const [a, b] = await Promise.all([
      computePerceptualHash(await gradientImage(256, 256, 0)),
      computePerceptualHash(
        await sharp(await gradientImage(256, 256, 0))
          .flop()
          .png()
          .toBuffer(),
      ),
    ]);

    expect(perceptualHashDistance(a!, b!)).toBeGreaterThan(PERCEPTUAL_HASH_MATCH_THRESHOLD);
  });

  it('answers null for bytes it cannot decode instead of throwing', async () => {
    // A derivative job that otherwise succeeded must not fail on an
    // advisory, and neither must the upload behind it.
    expect(await computePerceptualHash(Buffer.from('not an image'))).toBeNull();
  });
});

describe('perceptualHashDistance', () => {
  it('is zero for the same hash and sixty-four for its inverse', () => {
    expect(perceptualHashDistance('0f0f0f0f0f0f0f0f', '0f0f0f0f0f0f0f0f')).toBe(0);
    expect(perceptualHashDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('counts differing bits, not differing characters', () => {
    expect(perceptualHashDistance('0000000000000000', '0000000000000003')).toBe(2);
  });
});
