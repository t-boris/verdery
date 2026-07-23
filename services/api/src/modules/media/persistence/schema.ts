import type { Generated } from 'kysely';

/**
 * `media.media_record` has no UPDATE path — every row is immutable after
 * insert — so `created_at` is the only database-defaulted column here.
 */
export interface MediaRecordRow {
  id: string;
  storage_reference: string;
  mime_type: string;
  uploaded_by_profile_id: string;
  created_at: Generated<Date>;
}

export interface MediaDatabaseSchema {
  'media.media_record': MediaRecordRow;
}
