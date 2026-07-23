import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "task"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`); P5-CONFLICT-01,
/// Stage 6 (`SyncConflictReplayableApplier`).
public struct TaskSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictReplayableApplier {
    public let recordType = "task"

    private let localStore: any LocalTaskStore

    public init(localStore: any LocalTaskStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(taskId: recordId, revision: revision)
    }

    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .task(task) = snapshot else { return }
        try await localStore.save(task)
    }

    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {
        try await localStore.delete(taskId: recordId)
    }

    /// P5-SEC-01: removes every `task` row this device has cached for
    /// `gardenId`, as part of `RemoteSyncEngine+Pull.swift`'s
    /// garden-partition cascade — see that method's own doc comment, and
    /// `CoreSynchronization.SyncRecordApplier
    /// .removeGardenScopedData(gardenId:)`'s own doc comment for the full
    /// contract.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.removeAll(gardenId: gardenId)
    }

    /// See `SyncConflictReplayableApplier.reapplyDraft(original:newExpectedRevision:)`'s
    /// own doc comment. Every task command besides `tasks.createManualTask`
    /// (never offered `reapplyLocalIntent` — see `ConflictRecoveryPolicy`'s
    /// own table) carries a complete new field value or is a pure state
    /// transition, never an index, so replacing only
    /// `command.expectedRevision` is exactly "reapply the same local intent."
    public func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft {
        let payload = try ConflictResolutionPayloadEditing.replacingExpectedRevision(
            in: original.payload,
            with: newExpectedRevision,
            orThrow: TaskCommandError.conflictResolutionPayloadMalformed
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
