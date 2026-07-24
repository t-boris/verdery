/**
 * MIME-signature (magic-byte) detection via `file-type` — a pure-JS,
 * no-native-dependency library, matching this stage's own pre-approved
 * architecture decision: "MIME-signature detection and dimension reading use
 * two new pure-JS, no-native-dependency libraries: `file-type` ... and
 * `image-size`" (see `image-metadata-parser.ts`'s own header comment for the
 * dimension-reading half of that same decision). This is the same class of
 * "architecturally critical, ADR-0002-covered" library addition
 * `@google-cloud/storage`/`@google-cloud/tasks` already were for this
 * package — a concrete library choice under an already-approved direction
 * (real byte-level file validation, architecture/media-storage-and-
 * processing.md section 8), not a new architectural decision.
 *
 * Deliberately NOT a hand-rolled magic-byte table and NOT a native-binding
 * decoder (`sharp`, `libvips`, etc.): a native dependency here would
 * reproduce exactly the "native binary dependency not yet in this stack"
 * problem that keeps ffprobe/video validation out of this stage's scope —
 * accepting one native dependency for images while deferring another for
 * video for the identical reason would be an inconsistent, undocumented
 * architecture fork. `file-type` covers every content type this stage's
 * `validation-policy.ts` allowlists (JPEG, PNG, WebP, HEIC/HEIF, PDF) from
 * magic bytes alone.
 *
 * Only ever consulted against the OBJECT'S OWN BYTES (the header
 * `MediaObjectSource` already captured), never a client-declared or
 * Cloud-Storage-reported content type — this is section 8's "MIME signature
 * rather than filename alone" made literal, and a strictly stronger signal
 * than `CompleteMediaUpload`'s own shallow declared-vs-Cloud-Storage-
 * reported check (client-suppliable metadata, not byte inspection).
 *
 * Source: architecture/media-storage-and-processing.md, section
 * "8. File Validation".
 */

import { fileTypeFromBuffer } from 'file-type';

/**
 * Detects the real content type from `header`'s magic bytes. Returns `null`
 * both when no signature matches (an unsupported or unrecognized format) and
 * when `file-type` itself cannot make a determination — never throws: an
 * inconclusive signature is exactly as actionable to the caller as no
 * signature, so both collapse to the same `null` result rather than an
 * exception `media-validator.ts` would otherwise need a second code path for.
 */
export async function detectContentType(header: Buffer): Promise<string | null> {
  try {
    const detected = await fileTypeFromBuffer(header);
    return detected?.mime ?? null;
  } catch {
    return null;
  }
}
