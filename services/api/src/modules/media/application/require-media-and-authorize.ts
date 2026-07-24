/**
 * Authorizes the caller against the path's own `gardenId`, then fetches the
 * media record by id and conceals both "no such media" and "this media
 * belongs to a different garden" as the identical `mediaNotFoundError` —
 * mirrors `GetPlant`'s own shape (authorize first, against the path's
 * `gardenId`, before any repository read; never distinguish the two
 * not-found cases to an unauthorized caller).
 *
 * Returns the caller's own `Membership`, not just the record: `GetMediaAccess`
 * needs `membership.role` to enforce section 12's viewer/`restricted`
 * distinction, which `GardenCapability`'s boolean matrix has no room for
 * (it depends on the specific media's own `sensitivityClassification`, not a
 * blanket per-role permission) — see that command's own comment.
 */

import type {
  GardenAuthorization,
  GardenCapability,
  Membership,
} from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRecord } from '../domain/media-record.js';
import { mediaNotFoundError } from './media-errors.js';
import type { MediaRepository } from './media-repository.js';

export interface AuthorizedMedia {
  readonly membership: Membership;
  readonly record: MediaRecord;
}

export async function requireMediaAndAuthorize(
  media: MediaRepository,
  authorization: GardenAuthorization,
  gardenId: Uuid,
  mediaId: Uuid,
  profileId: Uuid,
  capability: GardenCapability,
): Promise<AuthorizedMedia> {
  const membership = await authorization.requireCapability(gardenId, profileId, capability);

  const record = await media.get(mediaId);
  if (record === null || record.gardenId !== gardenId) {
    throw mediaNotFoundError();
  }

  return { membership, record };
}
