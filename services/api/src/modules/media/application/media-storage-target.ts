/**
 * Pure helpers for deciding WHERE a media object lives in Cloud Storage:
 * which of the four buckets section 4 names, and what opaque object key it
 * gets. Neither function touches Cloud Storage itself — `RegisterMediaUpload`
 * calls both before it ever calls `MediaStorageGateway`.
 *
 * Source: architecture/media-storage-and-processing.md, section "4. Storage Layout".
 */

import { createHash } from 'node:crypto';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaClass } from '../domain/media-record.js';

/**
 * The four bucket names section 4 lists (`grow-garden-<env>-user-media`,
 * `-raw-capture`, `-derived`, `-exports`) — real names are environment
 * configuration (`infrastructure/gcloud/config/dev.env`'s
 * `VERDERY_USER_MEDIA_BUCKET` and its three siblings), never hardcoded here.
 */
export interface MediaStorageBucketNames {
  readonly userMedia: string;
  readonly rawCapture: string;
  readonly derived: string;
  readonly exports: string;
}

/**
 * Selects the bucket for a `MediaClass`, matching section 3's own class
 * table read against section 4's four buckets: `garden_photo` and
 * `imported_plan` are both ordinary user uploads (user-media);
 * `raw_capture` gets its own bucket (raw-capture, stricter retention, its
 * own IAM and lifecycle posture per `09-media-storage.sh`); `derived_preview`
 * and `processing_output` are both pipeline-produced artifacts (derived);
 * `export_package` is short-lived (exports).
 */
export function selectBucketName(mediaClass: MediaClass, buckets: MediaStorageBucketNames): string {
  switch (mediaClass) {
    case 'garden_photo':
    case 'imported_plan':
      return buckets.userMedia;
    case 'raw_capture':
      return buckets.rawCapture;
    case 'derived_preview':
    case 'processing_output':
      return buckets.derived;
    case 'export_package':
      return buckets.exports;
  }
}

/**
 * Generates an opaque object key: `<shard>/<mediaUuid>/<objectUuid>`
 * (section 4 exactly). `objectUuid` is a fresh UUIDv7, distinct from
 * `mediaId` — the media row's identity and the physical object's identity
 * are deliberately different values, matching section 5's "Signed URLs and
 * resumable session URLs are not persisted as identity" posture for storage
 * detail versus row identity.
 *
 * `shard` is NOT derived from either UUID's own leading characters: UUIDv7 is
 * time-ordered by construction (ADR references aside, `shared/identifiers/
 * uuid.ts`'s own doc comment says as much), so a shard built from a UUIDv7's
 * leading hex characters would cluster by upload time rather than spread
 * evenly — exactly the hotspotting a shard prefix exists to avoid. Instead,
 * `shard` is the first two hex characters of a SHA-256 hash of `mediaId`,
 * which distributes independently of upload time while staying a pure,
 * deterministic function of the media row's own id (so the same media row
 * would always compute the same shard if this function were ever called a
 * second time for it, even though it is not — `objectKey` itself is stored
 * once, at `authorizeMediaUpload`).
 */
export function generateObjectKey(mediaId: Uuid): string {
  const shard = createHash('sha256').update(mediaId).digest('hex').slice(0, 2);
  const objectUuid = generateUuidV7();

  return `${shard}/${mediaId}/${objectUuid}`;
}
