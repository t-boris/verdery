import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "task"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`).
public struct TaskSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier {
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
}
