/**
 * Port for prefix-scoped Cloud Storage object deletion (P6-RET-01) — the
 * byte-removal half of architecture/media-storage-and-processing.md section
 * 16 steps 4-6, the same port-plus-adapter-plus-fake convention
 * `MediaObjectSource`/`DerivativeObjectSink` already follow.
 */

export interface PrefixDeletionResult {
  /** Objects this call actually deleted (0 on a fully idempotent replay — the prefix was already empty). */
  readonly deletedObjectCount: number;
  /** Objects still present when the prefix was re-listed after deleting — non-zero means absence could NOT be verified. */
  readonly remainingObjectCount: number;
}

export interface ObjectDeleter {
  /**
   * Deletes every object under `objectKeyPrefix` in `bucketName`, then
   * re-lists the prefix to verify absence (section 16 step 6, "Verify
   * absence or record provider retry state"). An already-absent object is
   * SUCCESS, not an error — deletion is idempotent and this job is
   * delivered at-least-once. A provider failure throws; the HTTP target
   * turns that into a retryable 5xx for Cloud Tasks.
   */
  deletePrefix(bucketName: string, objectKeyPrefix: string): Promise<PrefixDeletionResult>;
}
