import CoreDomain
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeaturePlants

/// Coverage for the five offline-capable plant commands (`AddPlant`,
/// `UpdatePlantDetails`, `TransitionPlantLifecycleStage`, `SetPlantStatus`,
/// `MovePlant`) against a real GRDB database, per architecture/offline-
/// synchronization.md, section "6. Local Mutation Transaction" — the
/// P5-IOS-02 (Stage 4c) counterpart to `FeatureGardensTests.GardensUseCasesTests`
/// and `FeatureMapTests.MapUseCasesOfflineTests`.
///
/// None of these tests configure a `PlantGateway` at all — the five use
/// cases no longer accept one (see `PlantsUseCases.swift`) — so a passing
/// suite is itself evidence that adding, editing, transitioning, setting the
/// status of, or moving a plant while offline never attempts a network call.
@Suite("Plant use cases (offline)")
struct PlantsUseCasesOfflineTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func plant(
        id: String,
        gardenId: String = "garden-1",
        displayName: String = "Tomato",
        taxonomyReferenceId: String? = nil,
        varietyLabel: String? = nil,
        groupingKind: PlantGroupingKind = .individual,
        quantity: Int? = nil,
        lifecycleStage: PlantLifecycleStage = .planned,
        status: PlantStatus = .active,
        conditionNote: String? = nil,
        gardenAreaMapObjectId: String? = nil,
        placementMapObjectId: String? = nil,
        revision: Int = 3
    ) -> Plant {
        Plant(
            id: id,
            gardenId: gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: groupingKind,
            quantity: quantity,
            lifecycleStage: lifecycleStage,
            status: status,
            conditionNote: conditionNote,
            careGuidanceNote: nil,
            revision: revision,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Decodes an outbox row's stored `payload` as loose JSON, so a test can
    /// assert it matches `packages/api-contracts/openapi.yaml`'s
    /// `SyncPlantOperationPayload`/`SyncPlantCommand` field-for-field without
    /// needing a real server or the generated OpenAPI models — mirrors
    /// `MapUseCasesOfflineTests.decodedPayloadJSON`'s identical purpose.
    private func decodedPayloadJSON(_ operation: OutboxOperation) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(operation.payload.utf8))
        return try #require(object as? [String: Any])
    }

    // MARK: - AddPlant

    @Test("AddPlant writes a local projection and a plants.addPlant outbox row")
    func addPlantOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let addPlant = AddPlant(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" },
            generatePlantId: { "plant-1" }
        )

        let result = try await addPlant(
            gardenId: "garden-1",
            displayName: "  Tomato  ",
            taxonomyReferenceId: "tax-1",
            varietyLabel: "Roma",
            groupingKind: .row,
            quantity: 4,
            gardenAreaMapObjectId: "area-1",
            placementMapObjectId: "placement-1"
        )

        #expect(result.id == "plant-1")
        #expect(result.gardenId == "garden-1")
        #expect(result.displayName == "Tomato")
        #expect(result.lifecycleStage == .planned)
        #expect(result.status == .active)
        // Below the contract's `Revision` minimum of 1 — can never be
        // mistaken for a real server revision.
        #expect(result.revision == 0)

        let stored = try await store.fetch(plantId: "plant-1")
        #expect(stored == result)

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operations.count == 1)
        #expect(operation.id == "operation-1")
        #expect(operation.profileId == "profile-1")
        #expect(operation.gardenId == "garden-1")
        #expect(operation.commandType == "plants.addPlant")
        #expect(operation.commandVersion == 1)
        #expect(operation.targetRecordIds == ["plant-1"])
        #expect(operation.expectedRevision == nil)

        let json = try decodedPayloadJSON(operation)
        #expect(json["recordType"] as? String == "plant")
        #expect(json["gardenId"] as? String == "garden-1")
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "plants.addPlant")
        #expect(command["plantId"] as? String == "plant-1")
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["displayName"] as? String == "Tomato")
        #expect(request["taxonomyReferenceId"] as? String == "tax-1")
        #expect(request["varietyLabel"] as? String == "Roma")
        #expect(request["groupingKind"] as? String == "row")
        #expect(request["quantity"] as? Int == 4)
        #expect(request["gardenAreaMapObjectId"] as? String == "area-1")
        #expect(request["placementMapObjectId"] as? String == "placement-1")
    }

    @Test("AddPlant rejects an empty display name without writing anything")
    func addPlantRejectsEmptyName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let addPlant = AddPlant(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await addPlant(gardenId: "garden-1", displayName: "   ", groupingKind: .individual)
        }

        #expect(failure == .invalidDisplayName)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("AddPlant rejects a display name longer than 200 characters")
    func addPlantRejectsTooLongName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let addPlant = AddPlant(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await addPlant(gardenId: "garden-1", displayName: String(repeating: "a", count: 201), groupingKind: .individual)
        }

        #expect(failure == .invalidDisplayName)
    }

    // MARK: - UpdatePlantDetails

    @Test("UpdatePlantDetails writes a local projection and a plants.updateDetails outbox row, revision unchanged")
    func updatePlantDetailsOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        // Seed a server-confirmed plant, as `GetPlant` would.
        try await store.save(plant(id: "plant-1", displayName: "Tomato", varietyLabel: "Roma", revision: 4))

        let updatePlantDetails = UpdatePlantDetails(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 2_000) },
            generateOperationId: { "operation-2" }
        )

        let result = try await updatePlantDetails(
            gardenId: "garden-1",
            plantId: "plant-1",
            displayName: "Cherry Tomato",
            varietyLabel: .set(nil),
            conditionNote: .set("Wilting"),
            expectedRevision: 4
        )

        #expect(result.displayName == "Cherry Tomato")
        #expect(result.varietyLabel == nil)
        #expect(result.conditionNote == "Wilting")
        // Unchanged locally: the server, not this client, assigns the next
        // revision, which this device only learns once the push that
        // consumes this outbox operation is accepted.
        #expect(result.revision == 4)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "plants.updateDetails")
        #expect(operation.expectedRevision == 4)
        #expect(operation.gardenId == "garden-1")
        #expect(operation.targetRecordIds == ["plant-1"])

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "plants.updateDetails")
        #expect(command["expectedRevision"] as? Int == 4)
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["displayName"] as? String == "Cherry Tomato")
        // `.set(nil)` encodes an explicit `null`, not an omitted key.
        #expect(request.keys.contains("varietyLabel"))
        #expect(request["varietyLabel"] is NSNull)
        #expect(request["conditionNote"] as? String == "Wilting")
        // `.unchanged` fields are omitted entirely — `taxonomyReferenceId`
        // was never passed, so it stays `.unchanged` by default.
        #expect(request.keys.contains("taxonomyReferenceId") == false)
    }

    @Test("UpdatePlantDetails fails locally when this device has no local record for the plant")
    func updatePlantDetailsWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let updatePlantDetails = UpdatePlantDetails(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await updatePlantDetails(gardenId: "garden-1", plantId: "unknown-plant", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("UpdatePlantDetails rejects an empty display name without writing anything")
    func updatePlantDetailsRejectsEmptyName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        try await store.save(plant(id: "plant-1", revision: 1))
        let updatePlantDetails = UpdatePlantDetails(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await updatePlantDetails(gardenId: "garden-1", plantId: "plant-1", displayName: "  ", expectedRevision: 1)
        }

        #expect(failure == .invalidDisplayName)
        #expect(try await store.fetch(plantId: "plant-1")?.displayName == "Tomato")
    }

    // MARK: - TransitionPlantLifecycleStage

    @Test("TransitionPlantLifecycleStage transitions the stage locally and writes a plants.transitionLifecycleStage outbox row")
    func transitionLifecycleStageOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.save(plant(id: "plant-1", lifecycleStage: .seedling, revision: 2))

        let transition = TransitionPlantLifecycleStage(
            localStore: store,
            profileId: "profile-1",
            generateOperationId: { "operation-3" }
        )

        let result = try await transition(gardenId: "garden-1", plantId: "plant-1", stage: .flowering, expectedRevision: 2)

        #expect(result.lifecycleStage == .flowering)
        #expect(result.displayName == "Tomato")
        #expect(result.revision == 2)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "plants.transitionLifecycleStage")
        #expect(operation.expectedRevision == 2)

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "plants.transitionLifecycleStage")
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["stage"] as? String == "flowering")
    }

    @Test("TransitionPlantLifecycleStage fails locally when this device has no local record for the plant")
    func transitionLifecycleStageWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let transition = TransitionPlantLifecycleStage(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await transition(gardenId: "garden-1", plantId: "unknown-plant", stage: .growing, expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
    }

    // MARK: - SetPlantStatus

    @Test("SetPlantStatus transitions the status locally and writes a plants.setStatus outbox row")
    func setStatusOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.save(plant(id: "plant-1", status: .active, revision: 5))

        let setStatus = SetPlantStatus(localStore: store, profileId: "profile-1", generateOperationId: { "operation-4" })

        // Also how "delete a plant" works: there is no hard-delete endpoint.
        let result = try await setStatus(gardenId: "garden-1", plantId: "plant-1", status: .removed, expectedRevision: 5)

        #expect(result.status == .removed)
        #expect(result.revision == 5)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "plants.setStatus")
        #expect(operation.expectedRevision == 5)

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["status"] as? String == "removed")
    }

    @Test("SetPlantStatus fails locally when this device has no local record for the plant")
    func setStatusWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let setStatus = SetPlantStatus(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await setStatus(gardenId: "garden-1", plantId: "unknown-plant", status: .dead, expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
    }

    // MARK: - MovePlant

    @Test("MovePlant updates placement locally and writes a plants.movePlant outbox row")
    func movePlantOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.save(plant(id: "plant-1", gardenAreaMapObjectId: "area-old", revision: 6))

        let movePlant = MovePlant(localStore: store, profileId: "profile-1", generateOperationId: { "operation-5" })

        let result = try await movePlant(
            gardenId: "garden-1",
            plantId: "plant-1",
            gardenAreaMapObjectId: "area-new",
            placementMapObjectId: nil,
            expectedRevision: 6
        )

        #expect(result.gardenAreaMapObjectId == "area-new")
        #expect(result.placementMapObjectId == nil)
        #expect(result.revision == 6)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "plants.movePlant")
        #expect(operation.expectedRevision == 6)

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["gardenAreaMapObjectId"] as? String == "area-new")
        #expect(request.keys.contains("placementMapObjectId") == false)
    }

    @Test("MovePlant fails locally when this device has no local record for the plant")
    func movePlantWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let movePlant = MovePlant(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: PlantCommandError.self) {
            try await movePlant(
                gardenId: "garden-1",
                plantId: "unknown-plant",
                gardenAreaMapObjectId: nil,
                placementMapObjectId: nil,
                expectedRevision: 1
            )
        }

        #expect(failure == .localRecordNotFound)
    }
}
