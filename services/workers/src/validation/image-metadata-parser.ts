/**
 * Image dimension reading via `image-size` — a pure-JS, no-native-dependency
 * library, matching this stage's own pre-approved architecture decision (see
 * `content-signature.ts`'s own header comment for the MIME-detection half of
 * that same decision, and this file's own reasoning below for why using it
 * un-augmented is the correct, already-anticipated trade-off, not a gap).
 *
 * HEADER-ONLY BY DESIGN — NOT A FULL IMAGE DECODE, AND WHY THAT IS SUFFICIENT:
 *
 * `image-size` reads only the bytes a format's own dimension fields live in
 * (a PNG's IHDR chunk, a JPEG's SOF segment, and so on) — it never inflates,
 * decompresses, or decodes pixel data. This is itself most of this stage's
 * decompression/parser-bomb protection for images (architecture/media-
 * storage-and-processing.md section 8: "Decompression and parser-bomb
 * protection"): a maliciously crafted image designed to explode during pixel
 * decoding (a classic decompression bomb: a tiny compressed file whose
 * declared dimensions are enormous) is caught by comparing the DECLARED
 * dimensions this function reads against `maxDimension`/`maxPixels` BEFORE
 * any decode is ever attempted, not by surviving a decode attempt.
 *
 * The remaining defense-in-depth layer this stage relies on instead of a
 * full pixel decode is the download's own byte cap: `GcsMediaObjectSource`
 * enforces `policy.maxBytes` while STREAMING the object (see that file's own
 * header comment), so even a file whose header claims small, policy-
 * compliant dimensions but whose actual compressed payload is anomalously
 * large is still rejected before this function ever runs — parser-bomb
 * protection is the COMBINATION of "never decode declared-oversized
 * dimensions" (this file) and "never download unbounded bytes in the first
 * place" (the object source), not a full decode of every accepted image.
 *
 * KNOWN, DOCUMENTED LIMITATION: because this never decodes pixel data,
 * corruption confined entirely to the pixel payload AFTER a well-formed
 * header (as opposed to corruption in the header fields themselves, which
 * `image-size` does detect and throw on) is not caught by this stage. A
 * client-side image decoder downstream could still fail on such a file. This
 * is the accepted cost of avoiding a native full-decode dependency
 * (`sharp`/`libvips`) for the same reason `ffprobe` is deferred for video —
 * see this module's own architecture note in `media-validator.ts`. A future
 * stage may choose to add a bounded, sandboxed full-decode pass if this gap
 * proves to matter in practice; it is not built here.
 *
 * Source: architecture/media-storage-and-processing.md, section
 * "8. File Validation".
 */

import { imageSize } from 'image-size';
import type { ValidationMetadata } from './validation-result.js';

/**
 * Reads width/height/orientation from `header` (the object source's own
 * bounded header capture — never the full file). Throws a plain `Error` on
 * anything `image-size` itself cannot determine (an unsupported format, or a
 * header truncated before its own dimension fields) and on dimensions that
 * violate `maxDimension`/`maxPixels` — both are "malformed_file"-shaped
 * rejections from `media-validator.ts`'s point of view, matching section 8's
 * "Rejection of active or unsupported content."
 */
export function parseImageMetadata(
  header: Buffer,
  maxPixels: number,
  maxDimension: number,
): ValidationMetadata {
  let size;
  try {
    size = imageSize(header);
  } catch (error) {
    throw new Error('Image dimensions are missing or invalid.', { cause: error });
  }

  const { width, height, orientation } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions are missing or invalid.');
  }
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new Error('Image dimensions exceed the validation policy.');
  }

  return {
    kind: 'image',
    width,
    height,
    ...(orientation === undefined ? {} : { orientation }),
  };
}
