import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "plant"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`).
public struct PlantSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier {
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
}
