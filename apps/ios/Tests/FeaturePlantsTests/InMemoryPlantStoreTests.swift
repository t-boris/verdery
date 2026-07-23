import CoreDomain
import Foundation
import Testing

@testable import FeaturePlants

@Suite("In-memory plant store")
struct InMemoryPlantStoreTests {
    private func plant(id: String, displayName: String, revision: Int = 1) -> Plant {
        Plant(
            id: id,
            gardenId: "garden-1",
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            displayName: displayName,
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: revision,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("Starts empty")
    func startsEmpty() async throws {
        let store = InMemoryPlantStore()
        #expect(try await store.fetch(plantId: "plant-1") == nil)
    }

    @Test("save upserts a single plant")
    func saveUpserts() async throws {
        let store = InMemoryPlantStore()
        try await store.save(plant(id: "1", displayName: "Backyard"))

        let renamed = plant(id: "1", displayName: "Front Yard")
        try await store.save(renamed)

        #expect(try await store.fetch(plantId: "1")?.displayName == "Front Yard")
    }

    private func operation(id: String, plantId: String) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "plants.addPlant",
            commandVersion: 1,
            targetRecordIds: [plantId],
            expectedRevision: nil,
            payload: #"{"recordType":"plant"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation applies the projection and hands the current record to the command")
    func commitOfflineMutationAppliesProjection() async throws {
        let store = InMemoryPlantStore()
        let created = plant(id: "1", displayName: "Tomato")

        let result = try await store.commitOfflineMutation(plantId: "1") { current in
            #expect(current == nil)
            return (created, operation(id: "op-1", plantId: "1"))
        }

        #expect(result == created)
        #expect(try await store.fetch(plantId: "1") == created)
    }

    @Test("save skips overwriting a plant with a pending offline mutation")
    func saveSkipsPendingPlant() async throws {
        let store = InMemoryPlantStore()
        let pending = plant(id: "1", displayName: "Renamed locally")
        _ = try await store.commitOfflineMutation(plantId: "1") { _ in
            (pending, operation(id: "op-1", plantId: "1"))
        }

        try await store.save(plant(id: "1", displayName: "Stale server name"))

        #expect(try await store.fetch(plantId: "1")?.displayName == "Renamed locally")
    }

    @Test("save writes normally for a plant with no pending offline mutation")
    func saveWritesWhenNotPending() async throws {
        let store = InMemoryPlantStore()
        let pending = plant(id: "1", displayName: "Renamed locally")
        _ = try await store.commitOfflineMutation(plantId: "1") { _ in
            (pending, operation(id: "op-1", plantId: "1"))
        }

        // A second, unrelated plant has no pending mutation of its own.
        try await store.save(plant(id: "2", displayName: "From server"))

        #expect(try await store.fetch(plantId: "2")?.displayName == "From server")
    }

    @Test("confirmSynced advances the revision and lifts the pending guard, without touching other fields")
    func confirmSyncedAdvancesRevisionAndLiftsPendingGuard() async throws {
        let store = InMemoryPlantStore()
        let pending = plant(id: "1", displayName: "Renamed locally")
        _ = try await store.commitOfflineMutation(plantId: "1") { _ in
            (pending, operation(id: "op-1", plantId: "1"))
        }

        try await store.confirmSynced(plantId: "1", revision: 8)

        let confirmed = try #require(await store.fetch(plantId: "1"))
        #expect(confirmed.displayName == "Renamed locally")
        #expect(confirmed.revision == 8)

        try await store.save(plant(id: "1", displayName: "From server"))
        #expect(try await store.fetch(plantId: "1")?.displayName == "From server")
    }

    @Test("confirmSynced is a silent no-op for a plant this device has no local row for")
    func confirmSyncedNoOpForUnknownPlant() async throws {
        let store = InMemoryPlantStore()
        try await store.confirmSynced(plantId: "unknown", revision: 3)
        #expect(try await store.fetch(plantId: "unknown") == nil)
    }
}
