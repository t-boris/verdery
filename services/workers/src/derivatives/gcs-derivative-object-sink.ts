/**
 * `@google-cloud/storage`-backed `DerivativeObjectSink`.
 *
 * Unlike `../validation/gcs-media-object-source.ts` (read-only, matching
 * validation's "Binary media bypasses the interactive API data path"
 * posture read the other way), this is this worker's own DIRECT write to
 * private Cloud Storage — a server-initiated write, not a client one, so it
 * needs no signed-upload-session dance (`MediaStorageGateway`'s own
 * resumable-session mechanism is for a CLIENT's own upload, not this
 * worker's). Authenticates through Application Default Credentials only —
 * this service's own runtime identity in Cloud Run, or a developer's
 * `gcloud auth application-default login` locally — matching every other
 * Google Cloud client in this monorepo (see `main.ts`'s own comment on
 * `CloudTasksClient`) and architecture/media-storage-and-processing.md
 * section 18's "No long-lived service-account keys."
 *
 * IAM: this write needs a grant `10-media-processing-queue.sh` did not
 * previously make — see that script's own updated comment
 * ("P6-WORKER-02 will need a separate, explicit derived-output write
 * grant") and this stage's own report for the exact role
 * (`roles/storage.objectCreator`, scoped to the derived bucket only,
 * combined with the pre-existing `roles/storage.objectViewer` this service
 * account already holds on all four media buckets).
 */

import { createHash } from 'node:crypto';
import type { Storage } from '@google-cloud/storage';
import type { DerivativeObjectSink, StoredDerivativeObject } from './derivative-object-sink.js';

export class GcsDerivativeObjectSink implements DerivativeObjectSink {
  constructor(
    private readonly storage: Storage,
    private readonly bucketName: string,
  ) {}

  async write(
    objectKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StoredDerivativeObject> {
    await this.storage.bucket(this.bucketName).file(objectKey).save(buffer, {
      contentType,
      resumable: false,
    });

    return {
      bucketName: this.bucketName,
      objectKey,
      byteSize: buffer.length,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }
}
