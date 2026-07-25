/**
 * `@google-cloud/storage`-backed `ExportObjectStore` (P8-EXPORT-01).
 *
 * The worker's own direct reads and writes against the private exports and
 * user-media buckets — the `GcsDerivativeObjectSink` posture (a
 * server-initiated transfer needs no signed-URL dance) plus the
 * `GcsMediaObjectSource` read side. Application Default Credentials only,
 * like every Google Cloud client in this monorepo.
 *
 * IAM this needs beyond the derivative sink's grants:
 * `roles/storage.objectCreator` scoped to the EXPORTS bucket — combined
 * with the objectViewer the worker already holds on all four buckets
 * (reading staged sections and media originals back) and the delete-only
 * custom role P6-RET-01 already binds on the exports bucket, which is what
 * makes a retried attempt's OVERWRITE of the same staging/package object
 * key legal (a GCS overwrite is delete + create). Never `objectAdmin` —
 * the derivative grant's own least-privilege reasoning. Drafted in
 * `infrastructure/gcloud/scripts/10-media-processing-queue.sh`, written
 * and reviewed but not executed, the established infra posture.
 */

import { createHash } from 'node:crypto';
import type { Storage } from '@google-cloud/storage';
import type {
  ExportObjectStore,
  ExportObjectWriteStream,
  StoredExportObject,
} from './export-object-store.js';

interface GcsErrorLike {
  readonly code?: number;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as GcsErrorLike).code === 404;
}

export class GcsExportObjectStore implements ExportObjectStore {
  constructor(private readonly storage: Storage) {}

  async write(
    bucketName: string,
    objectKey: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredExportObject> {
    await this.storage.bucket(bucketName).file(objectKey).save(content, {
      contentType,
      resumable: false,
    });

    return {
      bucketName,
      objectKey,
      byteSize: content.length,
      checksumSha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async read(bucketName: string, objectKey: string): Promise<Buffer | null> {
    try {
      const [content] = await this.storage.bucket(bucketName).file(objectKey).download();
      return content;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  openWriteStream(
    bucketName: string,
    objectKey: string,
    contentType: string,
  ): ExportObjectWriteStream {
    const stream = this.storage
      .bucket(bucketName)
      .file(objectKey)
      .createWriteStream({ contentType, resumable: false });

    const stored = new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });

    return { writable: stream, whenStored: () => stored };
  }
}
