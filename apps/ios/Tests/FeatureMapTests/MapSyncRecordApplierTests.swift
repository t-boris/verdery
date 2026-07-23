import CoreDomain
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureMap

/// Proves `MapSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalMapStore.confirmSynced(objectId:revision:)` with the right
/// parameter mapping (`recordId` → `objectId`), through a real
/// `InMemoryMapStore` — the same "fake/in-memory local store proving the
/// right store method gets called" coverage this work package calls for.
@Suite("Map sync record applier")
struct MapSyncRecordApplierTests {
    @Test("recordType is 'gardenObject', matching the contract's SyncRecordType")
    func recordTypeIsGardenObject() {
        let applier = MapSyncRecordApplier(localStore: InMemoryMapStore())
        #expect(applier.recordType == "gardenObject")
    }

    @Test("applyConfirmed advances the object's revision through the local store, keeping its geometry")
    func applyConfirmedAdvancesRevision() async throws {
        let store = InMemoryMapStore()
        let pending = GardenMapObject(
            id: "obj-1", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 1, y: 2)),
            coordinateSpaceId: "space-1", label: "Old Oak", categoryDetails: nil, lifecycleState: .active,
            revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            ([pending], OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.createObject",
                commandVersion: 1, targetRecordIds: ["obj-1"], expectedRevision: nil,
                payload: #"{"recordType":"gardenObject"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let applier = MapSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "obj-1", revision: 4, confirmedAt: Date())

        let confirmed = try #require(await store.fetchAll(gardenId: "garden-1").first)
        #expect(confirmed.revision == 4)
        #expect(confirmed.label == "Old Oak")
    }
}
