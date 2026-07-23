import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "plant"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stage 5a.
public struct PlantSyncRecordApplier: SyncRecordApplier {
    public let recordType = "plant"

    private let localStore: any LocalPlantStore

    public init(localStore: any LocalPlantStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(plantId: recordId, revision: revision)
    }
}
