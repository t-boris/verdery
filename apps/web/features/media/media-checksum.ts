/**
 * The SHA-256 of a file about to be uploaded.
 *
 * The contract asks for this "when available" and the browser never supplied
 * it, so every browser upload reached the server with nothing to verify the
 * bytes against: `CompleteMediaUpload` passes the declared checksum straight
 * into the processing event, and a `null` there means the worker validates a
 * file nobody claimed anything about. A swapped or truncated upload was
 * indistinguishable from a correct one.
 *
 * `crypto.subtle` is the platform's own implementation — no dependency, and
 * the same digest the server compares against. It is available only in a
 * secure context, which every deployed environment is; a browser that does not
 * expose it gets the previous behaviour (no checksum) rather than a failed
 * upload, because an unverifiable upload is still better than no upload.
 *
 * The whole file is read into memory to hash it. That is the same cost the
 * upload itself already pays, and the class ceiling is 50 MB.
 *
 * Source: architecture/media-storage-and-processing.md, section "7. Upload
 * Flow", step 1.
 */
export async function computeSha256Hex(file: Blob): Promise<string | null> {
  if (globalThis.crypto?.subtle === undefined) {
    return null;
  }

  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // Reading a file the user removed mid-pick, or a browser refusing the
    // digest: the upload proceeds unverified rather than failing on the
    // integrity step it was trying to strengthen.
    return null;
  }
}
