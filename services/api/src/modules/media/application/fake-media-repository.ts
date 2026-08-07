/**
 * The in-memory `MediaRepository`, split out of `media-test-doubles.ts` when
 * that file reached the 600-line limit.
 *
 * It is the natural seam: this fake is the largest of them, and the only one
 * that mirrors real query semantics rather than storing what it was handed —
 * ordering, keyset paging, original-versus-derivative filtering, and the
 * Hamming-distance comparison the real query delegates to PostgreSQL. Every
 * other double in that file is a few lines of bookkeeping.
 *
 * `media-test-doubles.ts` re-exports this, so no test's imports changed.
 */

import { PERCEPTUAL_HASH_MATCH_THRESHOLD } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRecord } from '../domain/media-record.js';
import type {
  FindDerivativeInput,
  ListForGardenInput,
  MediaPurgeScope,
  MediaRecordPage,
  MediaRepository,
} from './media-repository.js';

/** Mirrors the `bit_count(a # b)` the real query delegates to PostgreSQL. */
function hammingDistance(left: string, right: string): number {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let bits = 0;
  while (difference > 0n) {
    bits += Number(difference & 1n);
    difference >>= 1n;
  }
  return bits;
}

export class FakeMediaRepository implements MediaRepository {
  readonly records = new Map<Uuid, MediaRecord>();

  insert(record: MediaRecord): Promise<void> {
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  get(id: Uuid): Promise<MediaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  /** No real lock in memory — a unit test needs the same read, not the `FOR SHARE` serialization (that lives in the Testcontainers integration tests). */
  getForShare(id: Uuid): Promise<MediaRecord | null> {
    return this.get(id);
  }

  update(record: MediaRecord, expectedRevision: number): Promise<boolean> {
    const existing = this.records.get(record.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.records.set(record.id, record);
    return Promise.resolve(true);
  }

  /** In-memory mirror of the bulk `available` -> `deletion_scheduled` derivative transition. */
  scheduleDerivativesForDeletion(derivedFromMediaId: Uuid, now: Date): Promise<number> {
    return Promise.resolve(
      this.bulkTransitionDerivatives(derivedFromMediaId, 'available', 'deletion_scheduled', now),
    );
  }

  /** In-memory mirror of the bulk `deletion_scheduled` -> `deleted` derivative transition. */
  markScheduledDerivativesDeleted(derivedFromMediaId: Uuid, now: Date): Promise<number> {
    return Promise.resolve(
      this.bulkTransitionDerivatives(derivedFromMediaId, 'deletion_scheduled', 'deleted', now),
    );
  }

  private bulkTransitionDerivatives(
    derivedFromMediaId: Uuid,
    from: MediaRecord['uploadState'],
    to: MediaRecord['uploadState'],
    now: Date,
  ): number {
    let transitioned = 0;
    for (const [id, record] of this.records) {
      if (record.derivedFromMediaId === derivedFromMediaId && record.uploadState === from) {
        this.records.set(id, {
          ...record,
          uploadState: to,
          revision: record.revision + 1,
          updatedAt: now,
        });
        transitioned += 1;
      }
    }
    return transitioned;
  }

  /** In-memory mirror of `KyselyMediaRepository.listRetentionExpired`. */
  listRetentionExpired(now: Date, limit: number): Promise<readonly MediaRecord[]> {
    const matches = [...this.records.values()]
      .filter(
        (record) =>
          record.retentionDeadlineAt !== null &&
          record.retentionDeadlineAt.getTime() <= now.getTime() &&
          record.uploadState === 'available' &&
          record.derivedFromMediaId === null,
      )
      .sort(
        (a, b) =>
          (a.retentionDeadlineAt as Date).getTime() - (b.retentionDeadlineAt as Date).getTime(),
      );
    return Promise.resolve(matches.slice(0, limit));
  }

  /** In-memory mirror of `KyselyMediaRepository.listStaleUploads`. */
  listStaleUploads(cutoff: Date, limit: number): Promise<readonly MediaRecord[]> {
    const staleStates = ['registered', 'authorized', 'uploading', 'verifying'];
    const matches = [...this.records.values()]
      .filter(
        (record) =>
          staleStates.includes(record.uploadState) && record.updatedAt.getTime() < cutoff.getTime(),
      )
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    return Promise.resolve(matches.slice(0, limit));
  }

  findDerivative(input: FindDerivativeInput): Promise<MediaRecord | null> {
    const match = [...this.records.values()].find(
      (record) =>
        record.derivedFromMediaId === input.derivedFromMediaId &&
        record.transformationVersion === input.transformationVersion &&
        record.derivativeKind === input.derivativeKind &&
        record.tileZoomLevel === (input.tile?.zoomLevel ?? null) &&
        record.tileX === (input.tile?.x ?? null) &&
        record.tileY === (input.tile?.y ?? null),
    );
    return Promise.resolve(match ?? null);
  }

  /** The most recent `listForGarden` input, so a test can assert what the use case asked for. */
  lastListInput: ListForGardenInput | null = null;

  /** In-memory mirror of `KyselyMediaRepository.listForGarden`: originals only, `(createdAt, id)` descending, opaque index cursor. */
  listForGarden(input: ListForGardenInput): Promise<MediaRecordPage> {
    this.lastListInput = input;
    const ordered = [...this.records.values()]
      .filter(
        (record) =>
          record.gardenId === input.gardenId &&
          record.derivedFromMediaId === null &&
          record.uploadState !== 'deletion_scheduled' &&
          record.uploadState !== 'deleted' &&
          (input.mediaClass === null || record.mediaClass === input.mediaClass) &&
          (input.checksumSha256 === null || record.checksumSha256 === input.checksumSha256) &&
          (input.similarTo === null ||
            (record.id !== input.similarTo.excludeMediaId &&
              record.perceptualHash !== null &&
              hammingDistance(record.perceptualHash, input.similarTo.perceptualHash) <=
                PERCEPTUAL_HASH_MATCH_THRESHOLD)),
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );

    const start = input.cursor === null ? 0 : Number(input.cursor);
    const items = ordered.slice(start, start + input.limit);
    const nextCursor = start + input.limit < ordered.length ? String(start + input.limit) : null;

    return Promise.resolve({ items, nextCursor });
  }

  /** In-memory mirror of `KyselyMediaRepository.listDisplayDerivatives`: available non-tile derivatives, latest transformation version per kind. */
  listDisplayDerivatives(derivedFromMediaId: Uuid): Promise<readonly MediaRecord[]> {
    const byKind = new Map<string, MediaRecord>();
    for (const record of this.records.values()) {
      if (
        record.derivedFromMediaId !== derivedFromMediaId ||
        record.uploadState !== 'available' ||
        record.derivativeKind === null ||
        record.derivativeKind === 'tile'
      ) {
        continue;
      }
      const existing = byKind.get(record.derivativeKind);
      if (
        existing === undefined ||
        (record.transformationVersion ?? 0) > (existing.transformationVersion ?? 0)
      ) {
        byKind.set(record.derivativeKind, record);
      }
    }
    return Promise.resolve([...byKind.values()]);
  }

  /** In-memory mirror of the purge scope predicate — see `MediaPurgeScope`. */
  listPurgeCandidates(scope: MediaPurgeScope, limit: number): Promise<readonly MediaRecord[]> {
    const candidates = [...this.records.values()].filter(
      (record) =>
        this.inScope(record, scope) &&
        record.derivedFromMediaId === null &&
        record.uploadState !== 'deletion_scheduled' &&
        record.uploadState !== 'deleted',
    );
    return Promise.resolve(candidates.slice(0, limit));
  }

  countUndeletedForPurge(scope: MediaPurgeScope): Promise<number> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (record) => this.inScope(record, scope) && record.uploadState !== 'deleted',
      ).length,
    );
  }

  private inScope(record: MediaRecord, scope: MediaPurgeScope): boolean {
    return scope.kind === 'garden'
      ? record.gardenId === scope.gardenId
      : record.gardenId === null &&
          record.uploadedByProfileId === scope.profileId &&
          record.mediaClass === 'export_package';
  }
}
