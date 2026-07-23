import CoreDomain
import CoreNetworking
import Foundation

/// The seam a feature module implements so `RemoteSyncEngine` can apply a
/// confirmed push outcome back to that feature's own local read model,
/// without `CoreSynchronization` ever importing a `Feature*` module — the
/// same "shared type one level below both layers" resolution
/// `SyncEngine.swift`'s own doc comment already uses for `OutboxOperation`/
/// `AuthTokenProvider`, applied in the opposite direction here:
/// `CoreSynchronization`'s engine calls this protocol generically, and only
/// `AppCompositionRoot` — the one place allowed to import both
/// `CoreSynchronization` and every feature — ever names a concrete
/// conformer, registering it with `RemoteSyncEngine` at construction time.
///
/// Shaped around exactly one of the six push outcomes
/// (architecture/offline-synchronization.md, section "8. Push Protocol"):
/// `accepted`/`duplicate`, the only two where an existing local record's own
/// state must change. `RemoteSyncEngine` resolves the other four with
/// generic infrastructure already built in Phase 5 Stage 3, no feature
/// involvement needed at all:
///
/// - `conflict`: a durable `CoreDomain.SyncConflict`, written through
///   `CorePersistence.SyncConflictStore`. Every field it needs
///   (`conflictCode`, the server's current representation, the original
///   operation's own payload as `localRepresentation`) comes off the wire
///   response and the pushed `OutboxOperation` itself.
/// - `rejected`: a durable `CoreDomain.SyncOperationResult`, written through
///   `CorePersistence.SyncOperationResultStore` — same reasoning.
/// - `blockedByDependency`/`retryLater`: no local storage change of any
///   kind; the outbox row stays untouched for a future push attempt.
///
/// Only `accepted`/`duplicate` need a feature's own local store touched:
/// the pending record this device already projected optimistically must
/// have its revision advanced to the server's now-confirmed value, and only
/// the feature that owns that record type knows how to load and re-save it.
public protocol SyncRecordApplier: Sendable {
    /// The `SyncRecordType` wire value this applier owns — `"garden"`,
    /// `"gardenObject"`, `"plant"`, `"observation"`, or `"task"` — matching
    /// `packages/api-contracts/openapi.yaml`'s `SyncRecordType`/
    /// `SyncRecordReference.recordType` exactly. A plain `String`, not yet
    /// an enum, for the same reason `CoreDomain.SyncConflict.conflictCode`
    /// stays a `String`: this client's synchronization vocabulary is not
    /// pinned to a contract-owned enum anywhere else either.
    var recordType: String { get }

    /// Applies an `accepted` or `duplicate` outcome for one record this
    /// applier owns: advances the local projection to the server's
    /// confirmed revision. A silent no-op when this device has no local row
    /// for `recordId` — already removed, or never cached — the same
    /// defensive posture every `Local*Store.save`/`replaceAll` method
    /// already takes toward a record it does not know about.
    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws
}

/// The additional capability some `SyncRecordApplier`s support: applying a
/// pulled change for a record NOT necessarily originating from this device's
/// own pending operation — `GET /sync/changes`'s "genuinely new or
/// differently-changed record" case, as opposed to `applyConfirmed`'s "my
/// own operation got confirmed" case (P5-IOS-03, Stage 5b).
///
/// A separate, optional-to-conform-to protocol, not two more required
/// methods on `SyncRecordApplier` itself: `FeatureObservations
/// .ObservationSyncRecordApplier` maintains no full local read-model cache of
/// confirmed observations at all (`LocalObservationStore` only tracks THIS
/// device's own not-yet-synced rows — see that protocol's own doc comment),
/// so there is genuinely nothing for it to write a pulled upsert/delete
/// into. Conforming it here just to add a vacuous no-op would misrepresent
/// it as pull-capable when `RemoteSyncEngine`'s own "no pull-capable applier
/// registered for this record type, not an error" dispatch already covers
/// "nothing to do" honestly — the exact same posture `calibration` already
/// gets on the push side, since no applier is registered for it at all.
///
/// `RemoteSyncEngine` discovers conformance with `as? any SyncPullRecordApplier`
/// against the same `appliersByRecordType` dictionary `applyConfirmed`
/// already dispatches through, rather than a second registration list —
/// one seam, one dispatch table, for both push and pull.
public protocol SyncPullRecordApplier: SyncRecordApplier {
    /// Applies a pulled `upsert` change: writes `snapshot`'s own record
    /// through this applier's `save`/`replaceAll`-style local store method,
    /// which already guards against clobbering a pending local mutation for
    /// the same record — every Stage 4 sub-stage's own local store already
    /// carries that guard (`GRDBGardenStore.save(_:)`'s own doc comment is
    /// the canonical example), so this method adds no new one.
    ///
    /// A silent no-op when `snapshot` names a different record type than
    /// this applier owns — defensive only; `RemoteSyncEngine` dispatches by
    /// `recordType` already, so this should not happen in practice.
    func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws

    /// Applies a pulled `delete` tombstone for one record this applier owns.
    /// A tombstone carries no snapshot on the wire (`SyncChange`'s own
    /// contract doc comment), only identity and revision — `gardenId` is
    /// `nil` only for a record with no owning garden, mirroring
    /// `SyncChange.gardenId`'s own doc comment.
    func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws
}
