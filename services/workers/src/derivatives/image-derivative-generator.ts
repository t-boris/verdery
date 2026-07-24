/**
 * Real pixel-decode derivative generation via `sharp` — the exact
 * decompression `services/workers` deliberately AVOIDED during validation
 * (P6-WORKER-01's own header comment: parser-bomb protection against an
 * ATTACKER-CONTROLLED, not-yet-validated file). That reasoning does not
 * apply here: this module only ever runs against a source that has already
 * passed `media_validation`'s real checks (MIME signature, dimension
 * bounds, checksum, malware-scan-required-for-PDF gate) — decoding it here
 * is decoding an already-trusted file, which is exactly why P6-WORKER-02
 * moves `sharp` from `devDependencies` to a real production dependency (see
 * `package.json`'s own diff and this stage's report).
 *
 * EXIF handling — architecture/media-storage-and-processing.md section 9:
 * "Orientation is normalized. EXIF location is removed from derivatives
 * unless the product explicitly needs and authorizes it." Nothing in this
 * codebase authorizes it, so every derivative this module produces strips
 * ALL metadata (EXIF, ICC, XMP — GPS location included) unconditionally:
 * `sharp` does not copy input metadata to its output by default unless
 * `.withMetadata()` is explicitly called, which nothing in this file ever
 * does. `.rotate()` with no argument reads the EXIF `Orientation` tag,
 * applies it to the PIXELS (so the output renders upright without a client
 * needing to read EXIF itself), and is called before that same metadata is
 * dropped — "orientation normalized, then the tag itself stripped," the
 * exact sequence section 9 describes.
 */

import sharp from 'sharp';

export interface OrientedSourceImage {
  /** PNG — orientation-applied, all metadata stripped, full native resolution. A lossless intermediate: every derivative size below is generated from ONE clean decode, not from progressively-recompressed JPEG artifacts. */
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Decodes the source once — see this file's own header comment for the orientation/metadata handling. */
export async function decodeAndOrient(sourcePath: string): Promise<OrientedSourceImage> {
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export interface GeneratedImageBuffer {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
}

const JPEG_CONTENT_TYPE = 'image/jpeg';

/** Resizes the already-oriented, already-stripped intermediate to fit within `maxDimensionPx` on its long edge, never upscaling a smaller source (`withoutEnlargement`), and encodes as JPEG at `jpegQuality`. */
export async function resizeRasterDerivative(
  source: OrientedSourceImage,
  maxDimensionPx: number,
  jpegQuality: number,
): Promise<GeneratedImageBuffer> {
  const { data, info } = await sharp(source.buffer)
    .resize({
      width: maxDimensionPx,
      height: maxDimensionPx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: jpegQuality })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height, contentType: JPEG_CONTENT_TYPE };
}
