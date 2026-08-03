/**
 * `ListGardenMedia` (P6-PLAN-01): a garden's ORIGINAL media records, most
 * recently created first, optionally filtered to one class — the read the
 * plan-import flow picks an `imported_plan` document through.
 *
 * Derivative rows are excluded by the repository query itself
 * (`derived_from_media_id IS NULL`), never reachable through a
 * `derived_preview` filter — see the operation's own contract description
 * for why (a tile pyramid alone can run to thousands of rows). Each listed
 * record instead carries its own `derivatives` array, resolved the same way
 * `GetMediaStatus` resolves it.
 *
 * `checksumSha256` narrows to byte-identical originals: the exact-duplicate
 * check a client runs against a photograph it has just hashed. Identical bytes
 * only — a re-encoded copy of the same scene is a different checksum, and
 * recognising THAT needs a perceptual hash nothing here computes.
 *
 * Authorization matches `GetMediaStatus`: `viewGarden` — this reads record
 * state, not bytes (`GetMediaAccess` owns the section 12 download rules).
 * Cursor/limit semantics mirror `ListGardens` exactly (opaque keyset
 * cursor, `limit + 1` look-ahead in the repository).
 */

import type { MediaListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { MediaClass } from '../domain/media-record.js';
import { toMediaResourceWithDerivatives } from './media-view.js';
import type { MediaRepository } from './media-repository.js';

export class ListGardenMedia {
  constructor(
    private readonly media: MediaRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    mediaClass: MediaClass | null,
    checksumSha256: string | null,
    cursor: string | null,
    limit: number,
  ): Promise<MediaListResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const page = await this.media.listForGarden({
      gardenId,
      mediaClass,
      checksumSha256,
      cursor,
      limit,
    });

    const items = await Promise.all(
      page.items.map(async (record) =>
        toMediaResourceWithDerivatives(record, await this.media.listDisplayDerivatives(record.id)),
      ),
    );

    return { items, ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }) };
  }
}
