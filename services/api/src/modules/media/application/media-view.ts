/**
 * Maps the domain `MediaRecord` (and a storage gateway's own session/access
 * results) to the `@verdery/api-contracts` wire shapes P6-API-01's commands
 * and queries return.
 *
 * Distinct from `media-record-view.ts`'s `MediaRecordResource`
 * (P6-DATA-01's own internal shape, still used by `RegisterMediaRecord` and
 * its integration test): that view predates this contract and includes
 * `bucketName`/`objectKey`, which the contract `Media` schema deliberately
 * omits — see `openapi.yaml`'s own comment on why. `toMediaResource` below
 * is the contract-conforming mapping every HTTP-facing command/query in this
 * file uses instead.
 */

import type { Media, MediaAccess, MediaUploadSession } from '@verdery/api-contracts';
import type { MediaRecord } from '../domain/media-record.js';
import type {
  MediaResumableUploadSession,
  MediaSignedDownloadAccess,
} from './media-storage-gateway.js';

export function toMediaResource(record: MediaRecord): Media {
  return {
    id: record.id,
    // Always non-null for every record reachable through a garden-scoped
    // endpoint — see `Media.gardenId`'s own description in openapi.yaml.
    gardenId: record.gardenId as string,
    uploadedByProfileId: record.uploadedByProfileId,
    mediaClass: record.mediaClass,
    displayFilename: record.displayFilename,
    declaredContentType: record.declaredContentType,
    verifiedContentType: record.verifiedContentType,
    declaredByteSize: record.declaredByteSize,
    verifiedByteSize: record.verifiedByteSize,
    checksumSha256: record.checksumSha256,
    uploadState: record.uploadState,
    processingState: record.processingState,
    sensitivityClassification: record.sensitivityClassification,
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toMediaUploadSessionResource(
  record: MediaRecord,
  session: MediaResumableUploadSession,
): MediaUploadSession {
  return {
    media: toMediaResource(record),
    uploadUrl: session.uploadUrl,
    uploadUrlExpiresAt: session.expiresAt.toISOString(),
  };
}

export function toMediaAccessResource(access: MediaSignedDownloadAccess): MediaAccess {
  return {
    url: access.url,
    expiresAt: access.expiresAt.toISOString(),
  };
}
