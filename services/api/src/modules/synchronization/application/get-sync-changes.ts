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
 * **Who produces a `'removed'` membership state (P8-DELETE-01 — this was
 * "nobody" until deletion shipped):** `RequestGardenDeletion` revokes every
 * non-owner member, `RestoreGardenDeletion` reactivates exactly those, and
 * the deletion purge revokes whoever is left before the garden row itself
 * disappears. The pull side written here needed no change to deliver any of
 * it, exactly as this comment predicted — with ONE addition that revocation
 * did force, in `platform.sync_change` rather than here: a revocation
 * tombstone is addressed to the revoked profile alone
 * (`target_profile_id`), because the same row reaching the still-active
 * owner would make the owner's client discard a garden they can still
 * recover. See the deletion baseline migration's own comment.
 *
 * A membership row therefore now OUTLIVES its garden: the purge deletes the
 * garden row but leaves the `'removed'` membership behind precisely so
 * `tombstoneOnlyGardenIds` below keeps working for a client that has not
 * reconnected yet.
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
  GardenRole,
  MembershipRepository,
} from '../../gardens-mapping/public.js';
import { roleHasCapability } from '../../gardens-mapping/public.js';
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
import { requiredPullCapability } from './sync-record-pull-capability.js';

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

/**
 * What `fetchRecordSnapshot` resolves to — a real snapshot, or `'revoked'`
 * when a fresh membership check (G-10) confirms the caller's access to the
 * row's own garden ended between the top of `execute` and this specific
 * row's own read. `toWireChange` turns the latter into the ordinary
 * `garden`/`delete` tombstone shape, never an `InternalError`.
 */
type RecordSnapshotOutcome =
  | { readonly kind: 'snapshot'; readonly snapshot: SyncRecordSnapshot }
  | { readonly kind: 'revoked' };

function toCalibrationSnapshot(calibration: {
  readonly id: Uuid;
  readonly backgroundObjectId: Uuid;
  readonly revision: number;
  readonly referencePoints: unknown;
  readonly knownDistance: unknown;
  readonly pageAspectRatio: number | null;
  readonly manualAdjustment: unknown;
  readonly transform: unknown;
  readonly pointResidualsMetres: readonly number[] | null;
  readonly residualErrorMetres: number | null;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
}): CalibrationContract {
  const snapshot: CalibrationContract = {
    id: calibration.id,
    backgroundObjectId: calibration.backgroundObjectId,
    revision: calibration.revision,
    // `Calibration.referencePoints` (this module's own domain shape) and the
    // api-contracts-generated one differ only in how strictly TypeScript
    // types `Position` (a loose `number[]` versus a strict
    // `readonly [number, number]` tuple) — both already serialize to
    // byte-identical JSON. This parameter's structured fields are typed
    // `unknown` specifically so this one cast per field (not a double cast
    // through `unknown` — already there) is enough, the same divergence
    // `route-garden-object-operation.ts`'s own identical comment documents
    // for `GardenObjectResource`/`GardenObject`.
    referencePoints: calibration.referencePoints as CalibrationContract['referencePoints'],
    residualErrorMetres: calibration.residualErrorMetres,
    createdByProfileId: calibration.createdByProfileId,
    createdAt: calibration.createdAt.toISOString(),
  };

  // The P6-PLAN-02 input/derivation fields are optional on the contract
  // only because a legacy P3-shaped row carries none of them — assigned
  // rather than conditionally spread so `exactOptionalPropertyTypes` can
  // see each key is only ever present with a real value.
  if (calibration.knownDistance !== null) {
    snapshot.knownDistance = calibration.knownDistance as NonNullable<
      CalibrationContract['knownDistance']
    >;
  }
  if (calibration.pageAspectRatio !== null) {
    snapshot.pageAspectRatio = calibration.pageAspectRatio;
  }
  if (calibration.manualAdjustment !== null) {
    snapshot.manualAdjustment = calibration.manualAdjustment as NonNullable<
      CalibrationContract['manualAdjustment']
    >;
  }
  if (calibration.transform !== null) {
    snapshot.transform = calibration.transform as NonNullable<CalibrationContract['transform']>;
  }
  if (calibration.pointResidualsMetres !== null) {
    snapshot.pointResidualsMetres = [...calibration.pointResidualsMetres];
  }
  return snapshot;
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
    // G-9's own boundary check needs the caller's role per garden, which
    // `activeGardenIds` above (built for the query's visibility filter only)
    // discards — see `sync-record-pull-capability.ts`'s own header comment.
    const activeRoleByGardenId = new Map<Uuid, GardenRole>(
      memberships
        .filter((membership) => membership.state === 'active')
        .map((membership): [Uuid, GardenRole] => [membership.gardenId, membership.role]),
    );

    const rows = await this.syncChanges.listAfter({
      profileId,
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
      items.push(await this.toWireChange(row, profileId, activeRoleByGardenId));
    }

    const lastSequence = rows.at(-1)?.sequence ?? cursor.afterSequence;
    const nextCursor = encodeSyncChangesCursor({ afterSequence: lastSequence, issuedAt: now });

    return { items, nextCursor };
  }

  private async toWireChange(
    row: SyncChangeRecord,
    profileId: Uuid,
    activeRoleByGardenId: ReadonlyMap<Uuid, GardenRole>,
  ): Promise<SyncChange> {
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

    const outcome = await this.fetchRecordSnapshot(
      row.gardenId,
      row.recordId,
      row.recordType,
      profileId,
      activeRoleByGardenId.get(row.gardenId),
    );

    if (outcome.kind === 'revoked') {
      // G-10 (`docs/development/garden-capability-matrix.md`): the caller's
      // access to THIS row's own garden ended between `listMembershipsForProfile`
      // above and this row's own read — confirmed just now by a fresh
      // membership check, not inferred from the error's shape. Surfaced as
      // the SAME ordinary `garden`/`delete` tombstone
      // offline-synchronization.md section "11.1 Implemented revocation
      // profile" already documents for every other revocation, addressed to
      // nobody in particular here (this response IS this profile's own
      // pull) — never as an `InternalError`. A full resync (section "13. Full
      // Resynchronization") is NOT used for this case: every authorization
      // revocation this codebase produces is already representable as an
      // ordinary per-garden tombstone (section 11.1), so partition reset stays
      // reserved for the two triggers `sync-changes-cursor.ts` already
      // implements (an expired cursor, an unsupported protocol version) — a
      // race landing here is not a third kind of staleness, just this same
      // kind observed one row earlier than the row that will carry it next
      // page. The real tombstone (written by whichever command revoked this
      // membership) still arrives on a later page, addressed and idempotent
      // exactly like any other — this is a defensive same-page substitute for
      // an internal error, not a replacement for it.
      return {
        sequence: row.sequence,
        gardenId: row.gardenId,
        recordId: row.gardenId,
        recordType: 'garden',
        operation: 'delete',
        recordRevision: row.recordRevision,
        committedAt: row.committedAt.toISOString(),
      };
    }

    return { ...base, record: outcome.snapshot };
  }

  private async fetchRecordSnapshot(
    gardenId: Uuid,
    recordId: Uuid,
    recordType: SyncRecordType,
    profileId: Uuid,
    activeRole: GardenRole | undefined,
  ): Promise<RecordSnapshotOutcome> {
    // G-9: a defence-in-depth boundary assertion, not the real enforcement —
    // each reader below still runs its own `GardenAuthorization.requireCapability`
    // unchanged. `activeRole` is always defined here in practice: this method
    // only runs for an `upsert` row, whose `gardenId` was already established
    // to be in `activeGardenIds` (and therefore in `activeRoleByGardenId`) by
    // the same call to `listMembershipsForProfile` moments earlier.
    if (
      activeRole === undefined ||
      !roleHasCapability(activeRole, requiredPullCapability(recordType))
    ) {
      throw new InternalError(
        'synchronization.changes.record_family_not_readable',
        `A ${recordType} change was not readable by the caller's own declared role — a regression in the pull path's own capability pin (G-9).`,
      );
    }

    try {
      switch (recordType) {
        case 'garden':
          // `recordId` is the garden's own id for this record type — the
          // record IS the garden, the same identity `route-garden-operation.ts`'s
          // own `fetchCurrentRecord` relies on.
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'garden',
              data: await this.readers.getGarden.execute(gardenId, profileId),
            },
          };
        case 'gardenObject':
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'gardenObject',
              data: (await this.readers.getMapObject.execute(
                gardenId,
                recordId,
                profileId,
              )) as unknown as GardenObjectContract,
            },
          };
        case 'calibration':
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'calibration',
              data: toCalibrationSnapshot(
                await this.readers.getCalibration.execute(gardenId, recordId, profileId),
              ),
            },
          };
        case 'plant':
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'plant',
              data: (await this.readers.getPlant.execute(
                gardenId,
                recordId,
                profileId,
              )) as unknown as PlantContract,
            },
          };
        case 'observation':
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'observation',
              data: (await this.readers.getObservationForSync.execute(
                gardenId,
                recordId,
                profileId,
              )) as unknown as ObservationContract,
            },
          };
        case 'task':
          return {
            kind: 'snapshot',
            snapshot: {
              recordType: 'task',
              data: (await this.readers.getTask.execute(
                gardenId,
                recordId,
                profileId,
              )) as unknown as TaskContract,
            },
          };
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        // G-10: confirm against the CURRENT membership state, rather than
        // assuming every `ApplicationError` here means the same thing.
        // `activeGardenIds` established this garden was accessible moments
        // earlier in the same call, so an authorization failure now most
        // likely means the caller's access ended in between (see this
        // method's own `activeRole` parameter for the other, already-pinned
        // half of this same "was true a moment ago" family of races) — but a
        // fresh read here proves it instead of guessing from the error's
        // shape.
        const stillActive = await this.memberships.findActiveByGardenAndProfile(
          gardenId,
          profileId,
        );
        if (stillActive === null) {
          return { kind: 'revoked' };
        }

        // Access is still active: this is NOT a revocation race. Nothing
        // hard-deletes any of these six record types (see each `Get*`
        // class's own header comment), so an honest internal error is a
        // better failure than crashing the whole page on a `404`/`403` that
        // would otherwise misreport a genuine sync-log inconsistency as
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
