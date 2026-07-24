import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRecord } from '../domain/media-record.js';

/**
 * Port for `media.media_record`.
 *
 * `insert` and `get` are P6-DATA-01's original minimal slice: that stage's
 * own doc comment on `media.media_record` said "No UPDATE path: every row is
 * immutable after insert in this minimal slice", true only because nothing
 * yet drove the upload/processing state machine through an HTTP endpoint.
 * P6-API-01 is exactly that endpoint — `RegisterMediaUpload` transitions a
 * freshly inserted row through `authorizeMediaUpload`, and
 * `CompleteMediaUpload` drives it through `beginMediaUpload` /
 * `beginMediaVerification` / `markMediaAvailable` / `markMediaRejected` — so
 * `update` is added now, revision-guarded exactly like
 * `PlantRepository.update`: `false` means the expected revision no longer
 * matched (lost a race or a stale `If-Match`), not a exception, mirroring
 * `applyPlantRevisionGuardedUpdate`'s own contract for its repository.
 *
 * `get` also continues to serve the sibling Phase 4 modules
 * (`plants-inventory`, `observations-history`, `tasks-recommendations`) that
 * validate a referenced media id exists before writing their own foreign key
 * to it.
 */
export interface MediaRepository {
  insert(record: MediaRecord): Promise<void>;
  get(id: Uuid): Promise<MediaRecord | null>;
  /** Writes `record` only if the stored row's current revision equals `expectedRevision`. Returns whether the write applied. */
  update(record: MediaRecord, expectedRevision: number): Promise<boolean>;
}
