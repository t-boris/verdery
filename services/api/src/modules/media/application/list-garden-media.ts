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
 * check a client runs against a photograph it has just hashed. Identical
 * bytes only.
 *
 * `similarToMediaId` answers the question the checksum cannot — "the garden
 * already holds this photograph, re-encoded". The client names a record
 * rather than supplying a hash, because the hash is computed server-side
 * during derivative generation and no client ever holds one. A reference
 * that does not exist, belongs to another garden, or has no hash yet
 * produces an EMPTY page rather than an error: a missing hash is an absent
 * answer to an advisory question, not a bad request.
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
import type { MediaRepository, SimilarMediaFilter } from './media-repository.js';

/**
 * The listing's optional narrowings, named rather than positional: five
 * consecutive nullable parameters is a call nobody can read at the call
 * site, and every one of them is independent of the others.
 */
export interface ListGardenMediaQuery {
  readonly mediaClass: MediaClass | null;
  readonly checksumSha256: string | null;
  readonly similarToMediaId: Uuid | null;
  readonly cursor: string | null;
  readonly limit: number;
}

export class ListGardenMedia {
  constructor(
    private readonly media: MediaRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    query: ListGardenMediaQuery,
  ): Promise<MediaListResult> {
    const { mediaClass, checksumSha256, similarToMediaId, cursor, limit } = query;
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    let similarTo: SimilarMediaFilter | null = null;
    if (similarToMediaId !== null) {
      const referenceId: Uuid = similarToMediaId;
      const reference = await this.media.get(referenceId);
      // Cross-garden references are treated as absent rather than denied:
      // this read is already gated on `viewGarden` for the garden being
      // listed, and answering "that record exists elsewhere" would leak the
      // existence of media in a garden the caller cannot see.
      if (
        reference === null ||
        reference.gardenId !== gardenId ||
        reference.perceptualHash === null
      ) {
        // No `nextCursor`: there is no further page of an absent answer.
        return { items: [] };
      }
      similarTo = { perceptualHash: reference.perceptualHash, excludeMediaId: referenceId };
    }

    const page = await this.media.listForGarden({
      gardenId,
      mediaClass,
      checksumSha256,
      similarTo,
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
