/**
 * `@google-cloud/storage`-backed `MediaStorageGateway`.
 *
 * Authenticates through Application Default Credentials only — the runtime
 * service account's own identity in Cloud Run, or a developer's
 * `gcloud auth application-default login` locally — matching every other
 * Google Cloud client this service constructs (see `main.ts`'s own comment
 * on `firebase-admin`) and section 18's "No long-lived service-account
 * keys." Never downloads or uploads object bytes: every method here either
 * creates a session/URL the CLIENT uses directly, or reads metadata alone.
 *
 * Source: architecture/media-storage-and-processing.md, sections "7. Upload
 * Flow", "12. Download Flow", "18. Security".
 */

import type { Storage } from '@google-cloud/storage';
import { SharedErrorCode } from '@verdery/api-contracts';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  MediaObjectMetadata,
  MediaResumableUploadSession,
  MediaSignedDownloadAccess,
  MediaStorageGateway,
  MediaStorageObjectTarget,
} from '../application/media-storage-gateway.js';

/** The shape `@google-cloud/storage` errors carry on an HTTP failure — narrower than importing its own `ApiError` type just to read one field. */
interface GcsErrorLike {
  readonly code?: number;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as GcsErrorLike).code === 404;
}

function translateGcsError(error: unknown): DependencyUnavailableError {
  return new DependencyUnavailableError(
    SharedErrorCode.DependencyUnavailable,
    'Cloud Storage is temporarily unavailable.',
    { cause: error },
  );
}

export class GcsMediaStorageGateway implements MediaStorageGateway {
  constructor(
    private readonly storage: Storage,
    private readonly uploadSessionTtlMs: number,
    private readonly signedDownloadTtlMs: number,
  ) {}

  async createResumableUploadSession(
    target: MediaStorageObjectTarget,
    declaredContentType: string,
    now: Date,
  ): Promise<MediaResumableUploadSession> {
    try {
      const file = this.storage.bucket(target.bucketName).file(target.objectKey);
      const [uploadUrl] = await file.createResumableUpload({
        metadata: { contentType: declaredContentType },
      });

      return { uploadUrl, expiresAt: new Date(now.getTime() + this.uploadSessionTtlMs) };
    } catch (error) {
      throw translateGcsError(error);
    }
  }

  async getObjectMetadata(target: MediaStorageObjectTarget): Promise<MediaObjectMetadata | null> {
    try {
      const [metadata] = await this.storage
        .bucket(target.bucketName)
        .file(target.objectKey)
        .getMetadata();

      return {
        contentType: metadata.contentType ?? '',
        sizeBytes: Number(metadata.size ?? 0),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw translateGcsError(error);
    }
  }

  async createSignedDownloadUrl(
    target: MediaStorageObjectTarget,
    now: Date,
  ): Promise<MediaSignedDownloadAccess> {
    try {
      const expiresAt = new Date(now.getTime() + this.signedDownloadTtlMs);
      const [url] = await this.storage
        .bucket(target.bucketName)
        .file(target.objectKey)
        .getSignedUrl({ action: 'read', expires: expiresAt, version: 'v4' });

      return { url, expiresAt };
    } catch (error) {
      throw translateGcsError(error);
    }
  }
}
