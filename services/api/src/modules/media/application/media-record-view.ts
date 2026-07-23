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
  readonly storageReference: string;
  readonly mimeType: string;
  readonly uploadedByProfileId: string;
  readonly createdAt: string;
}

export function toMediaRecordResource(record: MediaRecord): MediaRecordResource {
  return {
    id: record.id,
    storageReference: record.storageReference,
    mimeType: record.mimeType,
    uploadedByProfileId: record.uploadedByProfileId,
    createdAt: record.createdAt.toISOString(),
  };
}
