import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "gardenObject"`
/// — registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`).
public struct MapSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier {
    public let recordType = "gardenObject"

    private let localStore: any LocalMapStore

    public init(localStore: any LocalMapStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(objectId: recordId, revision: revision)
    }

    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .gardenObject(object) = snapshot else { return }
        try await localStore.save(object)
    }

    /// Unlike `GardenSyncRecordApplier.applyDelete`, this is a real, ordinary
    /// tombstone — see `LocalMapStore.delete(objectId:)`'s own doc comment
    /// for why a `gardenObject` deletion needs no revocation-style scope
    /// carve-out: it is already produced by real, live server-side commands
    /// (`delete-map-object.ts`, `join`/`split-map-object-linework.ts`) with
    /// no ambiguity about what "delete this object" means.
    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {
        try await localStore.delete(objectId: recordId)
    }

    /// P5-SEC-01: removes every `garden_object` row this device has cached
    /// for `gardenId`, as part of `RemoteSyncEngine+Pull.swift`'s
    /// garden-partition cascade — see that method's own doc comment, and
    /// `CoreSynchronization.SyncRecordApplier
    /// .removeGardenScopedData(gardenId:)`'s own doc comment for the full
    /// contract.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.removeAll(gardenId: gardenId)
    }
}
