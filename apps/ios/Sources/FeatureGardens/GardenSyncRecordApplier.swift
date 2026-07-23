import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "garden"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`); P5-CONFLICT-01,
/// Stage 6 (`SyncConflictReplayableApplier`).
public struct GardenSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictReplayableApplier {
    public let recordType = "garden"

    private let localStore: any LocalGardenStore

    public init(localStore: any LocalGardenStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(gardenId: recordId, revision: revision)
    }

    /// Reuses `LocalGardenStore.save(_:)` unchanged — the exact same
    /// "server-confirmed write, except when a pending offline mutation for
    /// this garden is still queued" guard a pulled garden from another
    /// device/session needs is already what `save(_:)` implements for a
    /// first-time server fetch (`GetGarden`/`ListGardens`); pull is simply a
    /// second real caller of it, not a new code path.
    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .garden(garden) = snapshot else { return }
        try await localStore.save(garden)
    }

    /// A deliberate no-op, not an oversight: a `garden`/`delete` change is
    /// the access-revocation tombstone (architecture/offline-
    /// synchronization.md, section "11. Authorization Changes"). Reacting to
    /// it — removing this garden's own local row, and every
    /// `garden_object`/`plant`/`observation`/`task` row still cached under
    /// it — is now P5-SEC-01's own `removeGardenScopedData(gardenId:)`
    /// below, invoked directly by `RemoteSyncEngine+Pull.swift`'s own
    /// garden-partition cascade for EVERY registered applier the moment a
    /// `garden`/`delete` change is seen, not routed back through this
    /// ordinary single-applier `applyDelete` dispatch — see that cascade's
    /// own doc comment for why. This method stays a no-op so the cascade
    /// remains the one, coherent place that reaction happens, rather than
    /// splitting "remove the garden's own row" across two call sites.
    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {}

    /// The one case among this codebase's five `removeGardenScopedData`
    /// conformers where `gardenId` names the applier's OWN record, not a
    /// record scoped underneath it (see that protocol requirement's own doc
    /// comment) — removes the garden's own local row.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.remove(gardenId: gardenId)
    }

    /// See `SyncConflictReplayableApplier.reapplyDraft(original:newExpectedRevision:)`'s
    /// own doc comment. `gardens.rename`/`gardens.archive`/
    /// `gardens.delete_request` all carry a top-level `command.expectedRevision`
    /// key (`GardenSyncCommand.encode(to:)`) — replacing only that scalar
    /// leaves every other field (including `gardens.rename`'s complete new
    /// `name`) untouched, exactly what "reapply the same local intent"
    /// requires (`ConflictRecoveryPolicy`'s own table).
    public func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft {
        let payload = try ConflictResolutionPayloadEditing.replacingExpectedRevision(
            in: original.payload,
            with: newExpectedRevision,
            orThrow: GardenCommandError.conflictResolutionPayloadMalformed
        )
        return ConflictResolutionOperationDraft(
            commandType: original.commandType,
            commandVersion: original.commandVersion,
            targetRecordIds: original.targetRecordIds,
            expectedRevision: newExpectedRevision,
            payload: payload
        )
    }
}
