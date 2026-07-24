/**
 * Read-only lookup for a single media record, scoped to a garden.
 *
 * Mirrors `GetPlant`'s own shape: authorize first, against the path's own
 * `gardenId`, `viewGarden` — any garden role, unlike `RegisterMediaUpload`/
 * `CompleteMediaUpload`'s `editGardenContent` — then fetch by id and conceal
 * both "no such media" and "this media belongs to a different garden" as the
 * identical `mediaNotFoundError`. The section 12 viewer/`restricted`
 * restriction does not apply here: that section is titled "Download Flow"
 * and concerns access to the bytes themselves (`GetMediaAccess`), not
 * reading a record's status.
 */

import type { Media } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { requireMediaAndAuthorize } from './require-media-and-authorize.js';
import { toMediaResource } from './media-view.js';
import type { MediaRepository } from './media-repository.js';

export class GetMediaStatus {
  constructor(
    private readonly media: MediaRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, mediaId: Uuid, profileId: Uuid): Promise<Media> {
    const { record } = await requireMediaAndAuthorize(
      this.media,
      this.authorization,
      gardenId,
      mediaId,
      profileId,
      'viewGarden',
    );

    return toMediaResource(record);
  }
}
