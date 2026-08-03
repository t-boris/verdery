/**
 * A 64-bit difference hash (dHash) of an already-decoded source image.
 *
 * The exact-duplicate check this complements compares SHA-256: it answers
 * "you uploaded these same bytes before" and nothing else. Re-encoding a
 * photo, resizing it, or exporting it from a phone gallery as a different
 * format produces different bytes and therefore no match — yet it is the
 * same picture, and a gardener who uploads it twice wants to know.
 *
 * dHash answers that. Resize to 9x8 greyscale, compare each pixel with its
 * right-hand neighbour, and the 64 resulting bits describe the image's
 * gradient structure rather than its bytes. Two encodings of one photograph
 * land within a few bits of each other; two different photographs do not.
 *
 * NO NEW DEPENDENCY: `sharp` is already this package's production
 * dependency for derivative generation, and the resize below is the same
 * call `image-derivative-generator.ts` makes. The owner declined a
 * perceptual-hashing library, and this needs none.
 *
 * WHAT IT DOES NOT DO: dHash is not robust to rotation or to aggressive
 * cropping — a 90-degree rotation is, structurally, a different image to
 * it. That is the deliberate limit of building this without the declined
 * dependency, recorded here rather than discovered later.
 *
 * Source: tasks/todo.md, "P11 remainder — the two engineering gaps,
 * decided (2026-08-03)"; architecture/media-storage-and-processing.md,
 * section 9.
 */

import { PERCEPTUAL_HASH_HEX_LENGTH } from '@verdery/api-contracts';
import sharp from 'sharp';

/** Columns sampled per row: 8 comparisons need 9 pixels. */
const HASH_WIDTH = 9;
/** Rows sampled: 8 rows x 8 comparisons = 64 bits. */
const HASH_HEIGHT = 8;

/**
 * The dHash of an image, as 16 lowercase hex characters, or `null` when the
 * bytes cannot be decoded.
 *
 * Returning `null` rather than throwing is deliberate: this hash is an
 * advisory used to warn about duplicates. A format `sharp` will not decode
 * must not fail a derivative job that has otherwise succeeded, and must not
 * fail the upload behind it.
 */
export async function computePerceptualHash(image: Buffer): Promise<string | null> {
  let pixels: Buffer;
  try {
    pixels = await sharp(image)
      // `fit: 'fill'` ignores the source aspect ratio on purpose: the hash
      // must describe the same grid regardless of how the image was
      // cropped to a different ratio by an export.
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }

  if (pixels.length < HASH_WIDTH * HASH_HEIGHT) {
    return null;
  }

  let hash = 0n;
  for (let row = 0; row < HASH_HEIGHT; row += 1) {
    for (let column = 0; column < HASH_WIDTH - 1; column += 1) {
      const left = pixels[row * HASH_WIDTH + column]!;
      const right = pixels[row * HASH_WIDTH + column + 1]!;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }

  return hash.toString(16).padStart(PERCEPTUAL_HASH_HEX_LENGTH, '0');
}

/**
 * How many bits differ between two hashes — the Hamming distance.
 *
 * The database answers this with `bit_count(a # b)` for real queries; this
 * exists so tests can state distances directly, and so the threshold below
 * is checkable without a container.
 */
export function perceptualHashDistance(left: string, right: string): number {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let bits = 0;
  while (difference > 0n) {
    bits += Number(difference & 1n);
    difference >>= 1n;
  }
  return bits;
}
