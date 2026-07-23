import CoreDomain
import CoreSynchronization
import Foundation
import Testing

@testable import FeaturePlants

/// Proves `PlantSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalPlantStore.confirmSynced(plantId:revision:)` with the right
/// parameter mapping (`recordId` → `plantId`), through a real
/// `InMemoryPlantStore` — the same "fake/in-memory local store proving the
/// right store method gets called" coverage this work package calls for.
@Suite("Plant sync record applier")
struct PlantSyncRecordApplierTests {
    private func plant(id: String, revision: Int = 0) -> Plant {
        Plant(
            id: id, gardenId: "garden-1", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: "Tomato", taxonomyReferenceId: nil, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: .individual, quantity: nil,
            lifecycleStage: .planned, status: .active, conditionNote: nil, careGuidanceNote: nil,
            revision: revision, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("recordType is 'plant', matching the contract's SyncRecordType")
    func recordTypeIsPlant() {
        let applier = PlantSyncRecordApplier(localStore: InMemoryPlantStore())
        #expect(applier.recordType == "plant")
    }

    @Test("applyConfirmed advances the plant's revision through the local store")
    func applyConfirmedAdvancesRevision() async throws {
        let store = InMemoryPlantStore()
        _ = try await store.commitOfflineMutation(plantId: "plant-1") { _ in
            (plant(id: "plant-1"), OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "plants.addPlant",
                commandVersion: 1, targetRecordIds: ["plant-1"], expectedRevision: nil,
                payload: #"{"recordType":"plant"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let applier = PlantSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "plant-1", revision: 3, confirmedAt: Date())

        #expect(try await store.fetch(plantId: "plant-1")?.revision == 3)
    }
}
