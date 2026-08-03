import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  MediaClass,
  MediaDerivativeKind,
  MediaRecord,
  TileCoordinates,
} from '../domain/media-record.js';

/** The idempotency key `findDerivative` looks up by — see `derivative-registration.ts`'s own doc comment. */
export interface FindDerivativeInput {
  readonly derivedFromMediaId: Uuid;
  readonly transformationVersion: number;
  readonly derivativeKind: MediaDerivativeKind;
  /** `null` for a non-tile derivative — every tile column is `NULL` on that row. */
  readonly tile: TileCoordinates | null;
}

/** `ListGardenMedia`'s repository input — originals only, optionally one class, cursor-paged (P6-PLAN-01). */
/** The reference image a similarity search compares against. */
export interface SimilarMediaFilter {
  readonly perceptualHash: string;
  /** The reference record itself, always excluded — every image matches its own hash exactly. */
  readonly excludeMediaId: Uuid;
}

export interface ListForGardenInput {
  readonly gardenId: Uuid;
  /** `null` lists every class (originals only either way). */
  readonly mediaClass: MediaClass | null;
  /** `null` applies no checksum restriction; a value lists only byte-identical originals. */
  readonly checksumSha256: string | null;
  /**
   * `null` applies no similarity restriction; a value lists originals whose
   * perceptual hash is within `PERCEPTUAL_HASH_MATCH_THRESHOLD` bits of the
   * given one, never including the record it came from.
   *
   * Independent of `checksumSha256`: a caller asking both gets the
   * intersection, which is almost never what it wants.
   */
  readonly similarTo: SimilarMediaFilter | null;
  /** Opaque continuation token a previous page returned; `null` for the first page. */
  readonly cursor: string | null;
  readonly limit: number;
}

export interface MediaRecordPage {
  readonly items: readonly MediaRecord[];
  readonly nextCursor: string | null;
}

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
/**
 * What a purge is clearing media for (P8-DELETE-01).
 *
 * `garden` is every media record the garden owns. `accountPackages` is
 * narrower on purpose: the only media an ACCOUNT purge owns outright are the
 * requester's own export packages, which are deliberately registered with no
 * garden (see `CompleteExport`) precisely so no garden-scoped route can serve
 * them. Everything else the person ever uploaded belongs to a garden — either
 * one being purged alongside the account, or one that survives with a
 * co-owner and keeps its content.
 */
export type MediaPurgeScope =
  | { readonly kind: 'garden'; readonly gardenId: Uuid }
  | { readonly kind: 'accountPackages'; readonly profileId: Uuid };

export interface MediaRepository {
  insert(record: MediaRecord): Promise<void>;
  get(id: Uuid): Promise<MediaRecord | null>;
  /**
   * `get` plus a `FOR SHARE` row lock held to the end of the enclosing
   * transaction (P6-RET-01) — the attach-side half of the
   * attach-versus-delete lock protocol `application/media-deletion-
   * workflow.ts` documents. Every command that inserts a row REFERENCING a
   * media record (plant photo, observation photo, task attachment,
   * imported background) reads the record through this method inside its
   * own transaction, so a concurrent `DeleteGardenMedia` — whose
   * `deletion_scheduled` UPDATE conflicts with the share lock — is
   * serialized: whichever commits first, the other observes it (the attach
   * re-reads a `deletion_scheduled` state and rejects; the delete's
   * post-update reference check sees the committed attachment and rolls
   * back). Meaningful only inside a transaction; on the pooled non-
   * transactional handle it degrades to a plain read.
   */
  getForShare(id: Uuid): Promise<MediaRecord | null>;
  /** Writes `record` only if the stored row's current revision equals `expectedRevision`. Returns whether the write applied. */
  update(record: MediaRecord, expectedRevision: number): Promise<boolean>;
  /**
   * Bulk `available` -> `deletion_scheduled` for every derivative row of
   * one source (P6-RET-01) — set-based deliberately, not row-by-row domain
   * transitions: a raster plan's tile pyramid alone can run to thousands
   * of derivative rows, and each one's transition is the identical
   * guarded edge (`scheduleMediaDeletion`'s own `available` precondition,
   * expressed as the statement's `WHERE upload_state = 'available'`;
   * `revision` and `updated_at` advance exactly as the domain function
   * would advance them). Returns how many rows transitioned.
   */
  scheduleDerivativesForDeletion(derivedFromMediaId: Uuid, now: Date): Promise<number>;
  /** Bulk `deletion_scheduled` -> `deleted` for one source's derivative rows — the completion half of `scheduleDerivativesForDeletion`, same set-based reasoning. */
  markScheduledDerivativesDeleted(derivedFromMediaId: Uuid, now: Date): Promise<number>;
  /**
   * `available` ORIGINAL records whose `retention_deadline_at` has passed,
   * oldest deadline first — the retention sweep's first candidate set
   * (P6-RET-01). Bounded by `limit`; the sweep drains the backlog across
   * successive runs rather than in one unbounded pass.
   */
  listRetentionExpired(now: Date, limit: number): Promise<readonly MediaRecord[]>;
  /**
   * Records still in a pre-`available` upload state whose `updated_at` is
   * older than `cutoff` — the retention sweep's orphan-reconciliation
   * candidate set (P6-RET-01; section 15's "metadata without objects" and
   * section 17's "A failed abandoned upload eventually releases reserved
   * capacity"). Bounded by `limit`, oldest first.
   */
  listStaleUploads(cutoff: Date, limit: number): Promise<readonly MediaRecord[]>;
  /** `null` when no derivative exists yet at this identity — see `FindDerivativeInput`'s own doc comment. */
  findDerivative(input: FindDerivativeInput): Promise<MediaRecord | null>;
  /**
   * A garden's ORIGINAL media rows (`derived_from_media_id IS NULL`), most
   * recently created first — never derivative rows, per `ListGardenMedia`'s
   * own contract description (P6-PLAN-01).
   */
  listForGarden(input: ListForGardenInput): Promise<MediaRecordPage>;
  /**
   * An original's `available` non-tile derivative rows (thumbnail, screen
   * preview, high-resolution), at most one per kind — the latest
   * `transformation_version` wins when regeneration produced several.
   * Tiles are deliberately excluded: unbounded, and tile consumption is
   * deferred (see `Media.derivatives`' contract description).
   */
  listDisplayDerivatives(derivedFromMediaId: Uuid): Promise<readonly MediaRecord[]>;
  /**
   * ORIGINAL records inside one purge scope that have not yet entered the
   * deletion pipeline (P8-DELETE-01). Derivative rows are excluded because
   * they follow their source through `scheduleDerivativesForDeletion`, the
   * same reason `DeleteGardenMedia` refuses a derivative directly. Bounded
   * by `limit`; a scope with more media finishes over successive sweep
   * passes, which the drain gate below makes safe.
   */
  listPurgeCandidates(scope: MediaPurgeScope, limit: number): Promise<readonly MediaRecord[]>;
  /**
   * How many records in the scope — originals AND derivatives — have not yet
   * reached `deleted`. The purge's gate: zero is the only value that means
   * every byte the deletion workflow owed has been confirmed absent
   * (P8-DELETE-01).
   */
  countUndeletedForPurge(scope: MediaPurgeScope): Promise<number>;
}
