import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "gardenObject"`
/// — registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stage 5a.
public struct MapSyncRecordApplier: SyncRecordApplier {
    public let recordType = "gardenObject"

    private let localStore: any LocalMapStore

    public init(localStore: any LocalMapStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(objectId: recordId, revision: revision)
    }
}
