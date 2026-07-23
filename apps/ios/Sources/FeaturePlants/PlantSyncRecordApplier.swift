import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "plant"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`); P5-CONFLICT-01,
/// Stage 6 (`SyncConflictReplayableApplier`).
public struct PlantSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictReplayableApplier {
    public let recordType = "plant"

    private let localStore: any LocalPlantStore

    public init(localStore: any LocalPlantStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(plantId: recordId, revision: revision)
    }

    /// Reuses `LocalPlantStore.save(_:)` unchanged — see
    /// `GardenSyncRecordApplier.applyUpsert(_:)`'s own doc comment for the
    /// identical reasoning: a pulled plant needs exactly the guard `save(_:)`
    /// already implements for a first-time server fetch.
    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .plant(plant) = snapshot else { return }
        try await localStore.save(plant)
    }

    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {
        try await localStore.delete(plantId: recordId)
    }

    /// P5-SEC-01: removes every `plant` row this device has cached for
    /// `gardenId`, as part of `RemoteSyncEngine+Pull.swift`'s
    /// garden-partition cascade — see that method's own doc comment, and
    /// `CoreSynchronization.SyncRecordApplier
    /// .removeGardenScopedData(gardenId:)`'s own doc comment for the full
    /// contract.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.removeAll(gardenId: gardenId)
    }

    /// See `SyncConflictReplayableApplier.reapplyDraft(original:newExpectedRevision:)`'s
    /// own doc comment. Every plant command besides `plants.addPlant` (never
    /// offered `reapplyLocalIntent` — see `ConflictRecoveryPolicy`'s own
    /// table) carries a complete new field value, never an index, so
    /// replacing only `command.expectedRevision` is exactly "reapply the
    /// same local intent."
    public func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft {
        let payload = try ConflictResolutionPayloadEditing.replacingExpectedRevision(
            in: original.payload,
            with: newExpectedRevision,
            orThrow: PlantCommandError.conflictResolutionPayloadMalformed
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
