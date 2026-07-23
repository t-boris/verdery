import CoreDomain
import CoreNetworking
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

    @Test("applyUpsert writes a genuinely new plant pulled from another device")
    func applyUpsertWritesGenuinelyNewPlant() async throws {
        let store = InMemoryPlantStore()
        let applier = PlantSyncRecordApplier(localStore: store)

        try await applier.applyUpsert(.plant(plant(id: "plant-2", revision: 1)))

        #expect(try await store.fetch(plantId: "plant-2")?.displayName == "Tomato")
    }

    @Test("applyDelete removes a real tombstone pulled from another device")
    func applyDeleteRemovesPlant() async throws {
        let store = InMemoryPlantStore()
        try await store.save(plant(id: "plant-1"))
        let applier = PlantSyncRecordApplier(localStore: store)

        try await applier.applyDelete(recordId: "plant-1", gardenId: "garden-1", revision: 1)

        #expect(try await store.fetch(plantId: "plant-1") == nil)
    }

    @Test("removeGardenScopedData removes every plant for the garden, even with a pending offline mutation queued, and leaves other gardens untouched")
    func removeGardenScopedDataRemovesEveryPlantUnconditionally() async throws {
        let store = InMemoryPlantStore()
        try await store.save(plant(id: "plant-confirmed"))
        _ = try await store.commitOfflineMutation(plantId: "plant-pending") { _ in
            (plant(id: "plant-pending"), OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "plants.addPlant",
                commandVersion: 1, targetRecordIds: ["plant-pending"], expectedRevision: nil,
                payload: #"{"recordType":"plant"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let otherGardenPlant = Plant(
            id: "plant-other-garden", gardenId: "garden-2", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: "Basil", taxonomyReferenceId: nil, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: .individual, quantity: nil,
            lifecycleStage: .planned, status: .active, conditionNote: nil, careGuidanceNote: nil,
            revision: 0, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
        try await store.save(otherGardenPlant)
        let applier = PlantSyncRecordApplier(localStore: store)

        try await applier.removeGardenScopedData(gardenId: "garden-1")

        #expect(try await store.fetch(plantId: "plant-confirmed") == nil)
        #expect(try await store.fetch(plantId: "plant-pending") == nil)
        #expect(try await store.fetch(plantId: "plant-other-garden") != nil)
    }

    @Test("reapplyDraft replaces only expectedRevision, keeping the rest of the original local intent")
    func reapplyDraftReplacesOnlyExpectedRevision() throws {
        let applier = PlantSyncRecordApplier(localStore: InMemoryPlantStore())
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "plants.setStatus",
            commandVersion: 1, targetRecordIds: ["plant-1"], expectedRevision: 4,
            payload: #"{"recordType":"plant","gardenId":"garden-1","command":{"commandType":"plants.setStatus","plantId":"plant-1","expectedRevision":4,"request":{"status":"dormant"}}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let draft = try applier.reapplyDraft(original: original, newExpectedRevision: 11)

        #expect(draft.expectedRevision == 11)
        #expect(draft.targetRecordIds == ["plant-1"])
        #expect(draft.payload.contains(#""expectedRevision":11"#))
        #expect(draft.payload.contains(#""status":"dormant""#))
    }

    @Test("reapplyDraft throws PlantCommandError.conflictResolutionPayloadMalformed for a create command with no expectedRevision")
    func reapplyDraftThrowsForMalformedPayload() {
        let applier = PlantSyncRecordApplier(localStore: InMemoryPlantStore())
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "plants.addPlant",
            commandVersion: 1, targetRecordIds: ["plant-1"], expectedRevision: nil,
            payload: #"{"recordType":"plant","gardenId":"garden-1","command":{"commandType":"plants.addPlant","plantId":"plant-1"}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        #expect(throws: PlantCommandError.conflictResolutionPayloadMalformed) {
            try applier.reapplyDraft(original: original, newExpectedRevision: 11)
        }
    }
}
