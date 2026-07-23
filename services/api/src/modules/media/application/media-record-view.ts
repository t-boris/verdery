/**
 * Maps the domain `MediaRecord` to the shape a command handler returns.
 *
 * Application code returns this view, not the domain entity, from
 * `RegisterMediaRecord`, matching gardens-mapping's own `toGardenResource`
 * convention: the idempotency store caches the literal response a retried
 * request must replay, so what a use case returns must be one fixed shape,
 * not something a later transport-layer mapping step could let drift.
 *
 * This module has no HTTP route this pass (see `transport/` — deliberately
 * absent), so there is no `@verdery/api-contracts` `Media` schema to conform
 * to yet. This resource shape is this module's own for now, ready for that
 * contract to adopt once a route exists.
 */

import type { MediaRecord } from '../domain/media-record.js';

export interface MediaRecordResource {
  readonly id: string;
  readonly gardenId: string | null;
  readonly uploadedByProfileId: string;
  readonly mediaClass: string;
  readonly displayFilename: string;
  readonly declaredContentType: string;
  readonly verifiedContentType: string | null;
  readonly declaredByteSize: number;
  readonly verifiedByteSize: number | null;
  readonly checksumSha256: string | null;
  readonly bucketName: string | null;
  readonly objectKey: string | null;
  readonly uploadState: string;
  readonly processingState: string | null;
  readonly captureSessionId: string | null;
  readonly sensitivityClassification: string;
  readonly retentionDeadlineAt: string | null;
  readonly derivedFromMediaId: string | null;
  readonly transformationVersion: number | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toMediaRecordResource(record: MediaRecord): MediaRecordResource {
  return {
    id: record.id,
    gardenId: record.gardenId,
    uploadedByProfileId: record.uploadedByProfileId,
    mediaClass: record.mediaClass,
    displayFilename: record.displayFilename,
    declaredContentType: record.declaredContentType,
    verifiedContentType: record.verifiedContentType,
    declaredByteSize: record.declaredByteSize,
    verifiedByteSize: record.verifiedByteSize,
    checksumSha256: record.checksumSha256,
    bucketName: record.bucketName,
    objectKey: record.objectKey,
    uploadState: record.uploadState,
    processingState: record.processingState,
    captureSessionId: record.captureSessionId,
    sensitivityClassification: record.sensitivityClassification,
    retentionDeadlineAt:
      record.retentionDeadlineAt === null ? null : record.retentionDeadlineAt.toISOString(),
    derivedFromMediaId: record.derivedFromMediaId,
    transformationVersion: record.transformationVersion,
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
