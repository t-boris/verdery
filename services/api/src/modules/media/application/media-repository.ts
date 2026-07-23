import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRecord } from '../domain/media-record.js';

/**
 * Port for `media.media_record`.
 *
 * Only `insert` and `get`: the migration's own doc comment on
 * `media.media_record` says "No UPDATE path: every row is immutable after
 * insert in this minimal slice", so there is no update method to speak of.
 * `get` exists for the sibling Phase 4 modules (`plants-inventory`,
 * `observations-history`, `tasks-recommendations`) that will want to
 * validate a referenced media id exists before writing their own foreign key
 * to it.
 */
export interface MediaRepository {
  insert(record: MediaRecord): Promise<void>;
  get(id: Uuid): Promise<MediaRecord | null>;
}
