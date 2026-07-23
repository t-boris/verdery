/**
 * `GET /v1/sync/changes` — reads `platform.sync_change` ordered by
 * `sequence`, filtered to gardens the calling profile currently has access
 * to, starting strictly after the given cursor, bounded by `limit`.
 *
 * ## Initial sync, snapshot, and full resync are this same call, not new machinery
 *
 * architecture/offline-synchronization.md, section "12. Initial
 * Synchronization" describes "snapshot pages tied to a snapshot boundary" —
 * read here as exactly what an omitted `after` already gives: the first page
 * this call returns starts from `sequence` `0` (nothing pulled yet) and
 * every row from there on is, by construction, everything the profile is
 * currently authorized to see. There is no separate "boundary" value to
 * compute or persist — the boundary *is* whatever `sequence` happens to be
 * current when the first page is served, exactly the same way an ordinary
 * incremental pull's own `nextCursor` already captures a resume point. A
 * client doing its first-ever sync is simply a client whose `after` is
 * omitted; nothing downstream of this method can tell the two cases apart,
 * because there is no third case.
 *
 * Section "13. Full Resynchronization" names three triggers this method
 * covers without new API surface: an `after` older than retained history and
 * an unsupported `protocolVersion` both throw the exact two stable
 * `error.code`s the contract's own `409` response documents
 * (`sync.changes.cursor_expired`, `sync.protocol_version.unsupported`) — the
 * client's own recovery for both is "call this endpoint again with `after`
 * omitted", which is the initial-sync case above, not a distinct resync
 * endpoint. The third trigger, "authorization partitions changed
 * incompatibly", is exactly what `tombstoneOnlyGardenIds` below already
 * handles as an ordinary tombstone row, not a distinct resync signal either.
 *
 * ## Revocation tombstones: why `tombstoneOnlyGardenIds` exists
 *
 * The contract's own `getSyncChanges` description is explicit: "a garden the
 * caller has lost access to surfaces as an ordinary `record: 'garden'`,
 * `operation: 'delete'` change… not a distinct change shape." Naively
 * filtering every row by *current* active membership would satisfy that for
 * every ordinary row but silently defeat it for the one row that matters
 * most — the revocation tombstone itself would also get filtered out, since
 * by definition the caller no longer has active membership on the garden it
 * names, leaving the client with silence instead of an explicit signal
 * (exactly the failure mode the architecture doc's section "11.
 * Authorization Changes" rules out: "Pending operations… become rejected",
 * not silently forgotten).
 *
 * This method resolves that by asking `MembershipRepository` for every
 * membership row the profile has, in *any* state (not just active), and
 * splitting it into `activeGardenIds` (ordinary full visibility) and
 * `tombstoneOnlyGardenIds` (visible only through that one garden's own
 * `record: 'garden'`, `operation: 'delete'` row — see
 * `sync-change-query.ts`'s own `listAfter` for the exact SQL condition this
 * produces). A profile with no membership row for a garden at all — active
 * or otherwise — sees nothing about it, ever; this is what stops the
 * tombstone-visibility carve-out from leaking to a profile who never had
 * access in the first place.
 *
 * **What is verified, not assumed, about who actually produces a
 * `'removed'` membership state today: nobody.** `MembershipRepository`
 * exposes exactly two writes — `insertOwner` (garden creation) and nothing
 * else; no command anywhere in this codebase (`identity-access`,
 * `gardens-mapping`, or otherwise) transitions a membership row away from
 * `'active'`, confirmed by inspection, the same way Stage 1 confirmed no
 * producer for `retryLater`. `collaboration.membership.state`'s own `CHECK`
 * constraint already anticipates `'removed'` (schema-first, unused), but
 * membership revocation is a genuine, currently unimplemented product-wide
 * gap — not merely a sync-side omission — and this is not the work package
 * that adds a revocation command. What this method *does* do is make the
 * pull side correct in advance: the moment a future revocation command
 * exists and writes its `platform.sync_change` tombstone the same way every
 * other mutating command already does (see `delete-map-object.ts` for the
 * established pattern), it is delivered correctly with zero further changes
 * here.
 *
 * ## Building each upsert row's `record`
 *
 * A `delete`-operation row carries no `record` at all (the contract's own
 * `SyncChange` doc comment: "no further payload is needed to apply it") —
 * this method never fetches a current snapshot for one, which is also what
 * keeps the tombstone case above simple: no authorization re-check is ever
 * attempted against a garden the caller has already lost access to.
 *
 * For an `upsert` row, the current snapshot is fetched through the same
 * authorized, capability-checked `Get*` query each sibling module already
 * exposes for `PushSyncOperations`'s own conflict payloads
 * (`route-plant-operation.ts` and its four siblings) — reused here
 * unchanged, not rebuilt as a parallel read path. Two gaps this pass fills,
 * both additive: `GetCalibration` (gardens-mapping had no single-calibration,
 * authorized read before this) and `GetObservationForSync`
 * (observations-history's existing `GetObservation` deliberately skips
 * authorization and photo/correction enrichment for its own, different
 * caller — see that class's own header comment for why it was not reused as
 * is).
 */

import type {
  Calibration as CalibrationContract,
  GardenObject as GardenObjectContract,
  Observation as ObservationContract,
  Plant as PlantContract,
  SyncChange,
  SyncChangesResult,
  SyncRecordSnapshot,
  Task as TaskContract,
} from '@verdery/api-contracts';
import { InternalError, ApplicationError } from '../../../platform/errors/application-error.js';
import type { SyncRecordType } from '../../../platform/sync/sync-record-type.js';
import type {
  GetCalibration,
  GetGarden,
  GetMapObject,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import type { GetObservationForSync } from '../../observations-history/public.js';
import type { GetPlant } from '../../plants-inventory/public.js';
import type { GetTask } from '../../tasks-recommendations/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { SyncChangeQuery, SyncChangeRecord } from './sync-change-query.js';
import {
  decodeSyncChangesCursor,
  encodeSyncChangesCursor,
  INITIAL_SYNC_CURSOR,
  requireFreshCursor,
} from './sync-changes-cursor.js';
import { requireSupportedSyncProtocolVersion } from './sync-protocol-version.js';

export interface GetSyncChangesRequest {
  readonly after: string | null;
  readonly limit: number;
  readonly protocolVersion: number;
}

/** The six per-record-family authorized readers this method fans an upsert row's `record` out to — bundled the same way `SyncOperationRouterDependencies` bundles its five per-family command sets, at a smaller scale. */
export interface SyncChangeRecordReaders {
  readonly getGarden: GetGarden;
  readonly getMapObject: GetMapObject;
  readonly getCalibration: GetCalibration;
  readonly getPlant: GetPlant;
  readonly getObservationForSync: GetObservationForSync;
  readonly getTask: GetTask;
}

function toCalibrationSnapshot(calibration: {
  readonly id: Uuid;
  readonly backgroundObjectId: Uuid;
  readonly revision: number;
  readonly referencePoints: unknown;
  readonly residualErrorMetres: number | null;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
}): CalibrationContract {
  return {
    id: calibration.id,
    backgroundObjectId: calibration.backgroundObjectId,
    revision: calibration.revision,
    // `Calibration.referencePoints` (this module's own domain shape) and the
    // api-contracts-generated one differ only in how strictly TypeScript
    // types `Position` (a loose `number[]` versus a strict
    // `readonly [number, number]` tuple) — both already serialize to
    // byte-identical JSON. This parameter is typed `unknown` specifically so
    // this one cast (not a double cast through `unknown` — already there) is
    // enough, the same divergence `route-garden-object-operation.ts`'s own
    // identical comment documents for `GardenObjectResource`/`GardenObject`.
    referencePoints: calibration.referencePoints as CalibrationContract['referencePoints'],
    residualErrorMetres: calibration.residualErrorMetres,
    createdByProfileId: calibration.createdByProfileId,
    createdAt: calibration.createdAt.toISOString(),
  };
}

export class GetSyncChanges {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly syncChanges: SyncChangeQuery,
    private readonly readers: SyncChangeRecordReaders,
    private readonly clock: Clock,
  ) {}

  async execute(profileId: Uuid, request: GetSyncChangesRequest): Promise<SyncChangesResult> {
    requireSupportedSyncProtocolVersion(request.protocolVersion);

    const now = this.clock.now();
    const cursor =
      request.after === null ? INITIAL_SYNC_CURSOR : decodeSyncChangesCursor(request.after);
    if (cursor.issuedAt !== null) {
      requireFreshCursor(cursor.issuedAt, now);
    }

    const memberships = await this.memberships.listMembershipsForProfile(profileId);
    const activeGardenIds = memberships
      .filter((membership) => membership.state === 'active')
      .map((membership) => membership.gardenId);
    const tombstoneOnlyGardenIds = memberships
      .filter((membership) => membership.state !== 'active')
      .map((membership) => membership.gardenId);

    const rows = await this.syncChanges.listAfter({
      activeGardenIds,
      tombstoneOnlyGardenIds,
      afterSequence: cursor.afterSequence,
      limit: request.limit,
    });

    // Sequential, not `Promise.all`: each row may issue its own authorization
    // and record-read queries, and a page is bounded to at most 100 rows
    // (`Limit`'s own contract maximum) — the same "bounded batch size,
    // sequential is fine" judgment `push-sync-operations.ts`'s own header
    // comment makes for its per-operation idempotency lookups.
    const items: SyncChange[] = [];
    for (const row of rows) {
      items.push(await this.toWireChange(row, profileId));
    }

    const lastSequence = rows.at(-1)?.sequence ?? cursor.afterSequence;
    const nextCursor = encodeSyncChangesCursor({ afterSequence: lastSequence, issuedAt: now });

    return { items, nextCursor };
  }

  private async toWireChange(row: SyncChangeRecord, profileId: Uuid): Promise<SyncChange> {
    const base = {
      sequence: row.sequence,
      gardenId: row.gardenId,
      recordId: row.recordId,
      recordType: row.recordType,
      operation: row.operation,
      recordRevision: row.recordRevision,
      committedAt: row.committedAt.toISOString(),
    };

    if (row.operation === 'delete') {
      return base;
    }

    if (row.gardenId === null) {
      // No real producer writes a `null` `gardenId` today (`SyncChangeRow`'s
      // own comment: "every change this service produces today always has
      // one") — an honest internal error, not a silently dropped row, if
      // that ever changed without this method being updated to cope.
      throw new InternalError(
        'synchronization.changes.missing_garden',
        'An upsert change had no owning garden.',
      );
    }

    const record = await this.fetchRecordSnapshot(
      row.gardenId,
      row.recordId,
      row.recordType,
      profileId,
    );
    return { ...base, record };
  }

  private async fetchRecordSnapshot(
    gardenId: Uuid,
    recordId: Uuid,
    recordType: SyncRecordType,
    profileId: Uuid,
  ): Promise<SyncRecordSnapshot> {
    try {
      switch (recordType) {
        case 'garden':
          // `recordId` is the garden's own id for this record type — the
          // record IS the garden, the same identity `route-garden-operation.ts`'s
          // own `fetchCurrentRecord` relies on.
          return {
            recordType: 'garden',
            data: await this.readers.getGarden.execute(gardenId, profileId),
          };
        case 'gardenObject':
          return {
            recordType: 'gardenObject',
            data: (await this.readers.getMapObject.execute(
              gardenId,
              recordId,
              profileId,
            )) as unknown as GardenObjectContract,
          };
        case 'calibration':
          return {
            recordType: 'calibration',
            data: toCalibrationSnapshot(
              await this.readers.getCalibration.execute(gardenId, recordId, profileId),
            ),
          };
        case 'plant':
          return {
            recordType: 'plant',
            data: (await this.readers.getPlant.execute(
              gardenId,
              recordId,
              profileId,
            )) as unknown as PlantContract,
          };
        case 'observation':
          return {
            recordType: 'observation',
            data: (await this.readers.getObservationForSync.execute(
              gardenId,
              recordId,
              profileId,
            )) as unknown as ObservationContract,
          };
        case 'task':
          return {
            recordType: 'task',
            data: (await this.readers.getTask.execute(
              gardenId,
              recordId,
              profileId,
            )) as unknown as TaskContract,
          };
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        // Not reachable in practice: `activeGardenIds` already established
        // this garden is currently accessible moments earlier in the same
        // call, and nothing hard-deletes any of these six record types (see
        // each `Get*` class's own header comment) — but an honest internal
        // error is a better failure than crashing the whole page on a `404`/
        // `403` that would otherwise misreport a sync-log inconsistency as
        // "this specific resource doesn't exist", mirroring
        // `route-plant-operation.ts`'s own `currentPlantRecordRevisions`
        // fallback for its analogous "should never happen" case.
        throw new InternalError(
          'synchronization.changes.record_missing',
          `A ${recordType} change referenced a record that could not be read.`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}
