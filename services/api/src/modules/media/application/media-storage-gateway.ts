/**
 * Port to Cloud Storage for one media object.
 *
 * This module's own name for what architecture/media-storage-and-processing.md
 * section 4 ("Storage Layout") and section 7 ("Upload Flow") describe:
 * backend-authorized resumable upload sessions, authoritative object
 * metadata for verification, and short-lived signed download access. Follows
 * this codebase's established port-plus-adapter-plus-fake convention (see
 * `platform/idempotency/idempotency-store.ts` and
 * `platform/outbox/outbox-appender.ts` for the general shape) — the real
 * adapter is `persistence/gcs-media-storage-gateway.ts`
 * (`@google-cloud/storage`-backed); tests use a fake implementing this same
 * interface.
 *
 * Deliberately minimal: three methods, matching exactly what P6-API-01's own
 * scope needs — "creating a backend-authorized resumable upload session for
 * one object ..., reading real object metadata (size, content type,
 * existence) for verification, and creating a short-lived signed download
 * URL." Nothing here reads or writes object bytes: section 2's "Binary media
 * bypasses the interactive API data path" applies to this port as much as to
 * the rest of the service.
 *
 * Source: architecture/media-storage-and-processing.md, sections "4. Storage
 * Layout", "7. Upload Flow", "12. Download Flow", "18. Security".
 */

/** Identifies one Cloud Storage object. Never persisted as identity on its own — always read from or written to `MediaRecord.bucketName`/`objectKey`. */
export interface MediaStorageObjectTarget {
  readonly bucketName: string;
  readonly objectKey: string;
}

/**
 * A backend-authorized resumable upload session for one object.
 *
 * `uploadUrl` is the session URI the client issues its own PUT requests
 * against directly — never proxied through this service. Matches section 7's
 * "Upload authorization is single-purpose, short-lived, size-bounded where
 * supported, and scoped to one object."
 */
export interface MediaResumableUploadSession {
  readonly uploadUrl: string;
  readonly expiresAt: Date;
}

/**
 * Authoritative object metadata as Cloud Storage itself reports it — never
 * the client's own declared values. `null` from `getObjectMetadata` below
 * means the object does not exist (the upload never reached Cloud Storage).
 */
export interface MediaObjectMetadata {
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** A short-lived signed download URL. Never a permanent one — section 18's "Signed access with short expiration." */
export interface MediaSignedDownloadAccess {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface MediaStorageGateway {
  /**
   * Creates a backend-authorized resumable upload session scoped to exactly
   * `target`, declaring `declaredContentType` as the object's content type.
   * `now` is the basis for `expiresAt`, injected so callers stay
   * deterministic under a fixed `Clock` — this method never reads the system
   * clock itself.
   */
  createResumableUploadSession(
    target: MediaStorageObjectTarget,
    declaredContentType: string,
    now: Date,
  ): Promise<MediaResumableUploadSession>;

  /** Reads real object metadata for verification. Returns `null` when no object exists at `target` — never throws for a simple absence. */
  getObjectMetadata(target: MediaStorageObjectTarget): Promise<MediaObjectMetadata | null>;

  /** Creates a short-lived signed download URL for an object already known to exist. */
  createSignedDownloadUrl(
    target: MediaStorageObjectTarget,
    now: Date,
  ): Promise<MediaSignedDownloadAccess>;
}
