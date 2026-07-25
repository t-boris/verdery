/**
 * `@google-cloud/storage`-backed `ObjectDeleter`.
 *
 * This is the ONE place in this whole system that deletes Cloud Storage
 * objects. Application Default Credentials only, matching every other
 * Google Cloud client in this monorepo (see `main.ts`'s own comment on
 * `CloudTasksClient`).
 *
 * IAM: `roles/storage.objectViewer` (already held on all four media
 * buckets) covers the `getFiles` listing; the DELETE itself needs
 * `storage.objects.delete`, which no predefined role grants without also
 * granting create/overwrite (`objectAdmin`) — so
 * `10-media-processing-queue.sh` creates a project-level CUSTOM role
 * carrying exactly `storage.objects.delete` and binds it per bucket. See
 * that script's own comment; written and syntax-checked, not executed live,
 * the same boundary every grant in that script has held to.
 *
 * Deletes are issued per object (not `bucket.deleteFiles`'s internal
 * queue) so a single missing object — deleted by a concurrent identical
 * job — is treated as the success it is (idempotent, at-least-once
 * delivery) rather than a batch failure, and so the count reported back is
 * what THIS call actually removed.
 */

import type { Storage } from '@google-cloud/storage';
import type { ObjectDeleter, PrefixDeletionResult } from './object-deleter.js';

const OBJECT_NOT_FOUND_STATUS = 404;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === OBJECT_NOT_FOUND_STATUS
  );
}

export class GcsObjectDeleter implements ObjectDeleter {
  constructor(private readonly storage: Storage) {}

  async deletePrefix(bucketName: string, objectKeyPrefix: string): Promise<PrefixDeletionResult> {
    const bucket = this.storage.bucket(bucketName);

    const [files] = await bucket.getFiles({ prefix: objectKeyPrefix });
    let deletedObjectCount = 0;
    for (const file of files) {
      try {
        await file.delete();
        deletedObjectCount += 1;
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
        // A concurrent identical deletion already removed it — the outcome
        // this job wanted; never an error.
      }
    }

    // Section 16 step 6: verify absence with a fresh listing, never by
    // trusting the delete calls' own success alone.
    const [remaining] = await bucket.getFiles({ prefix: objectKeyPrefix });
    return { deletedObjectCount, remainingObjectCount: remaining.length };
  }
}
