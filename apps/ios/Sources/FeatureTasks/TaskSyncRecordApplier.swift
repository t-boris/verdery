import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "task"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stage 5a.
public struct TaskSyncRecordApplier: SyncRecordApplier {
    public let recordType = "task"

    private let localStore: any LocalTaskStore

    public init(localStore: any LocalTaskStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(taskId: recordId, revision: revision)
    }
}
