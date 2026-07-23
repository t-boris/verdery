import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureGardens

/// Coverage for the four offline-capable garden commands
/// (`CreateGarden`, `RenameGarden`, `ArchiveGarden`, `RequestGardenDeletion`)
/// against a real GRDB database, per architecture/offline-synchronization.md,
/// section "6. Local Mutation Transaction".
///
/// None of these tests configure any network stub or `GardenGateway` at all
/// — the four use cases no longer accept one (see `GardensUseCases.swift`) —
/// so a passing suite is itself evidence that creating, renaming, archiving,
/// or requesting deletion of a garden while offline never attempts a network
/// call.
@Suite("Garden use cases (offline)")
struct GardensUseCasesTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func garden(
        id: String,
        name: String = "Backyard",
        lifecycleState: GardenLifecycleState = .active,
        revision: Int
    ) -> Garden {
        Garden(
            id: id,
            name: name,
            lifecycleState: lifecycleState,
            callerRole: .owner,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Mirrors `packages/api-contracts/openapi.yaml`'s
    /// `SyncGardenOperationPayload` / `SyncGardenCommand` structurally, so a
    /// test can assert an outbox row's stored `payload` would actually
    /// deserialize into a valid contract shape without needing a real
    /// server or the generated OpenAPI models.
    private struct DecodedGardenPayload: Decodable {
        let recordType: String
        let gardenId: String
        let command: DecodedCommand

        struct DecodedCommand: Decodable {
            let commandType: String
            let expectedRevision: Int?
            let request: DecodedRequest?

            struct DecodedRequest: Decodable {
                let name: String
            }
        }
    }

    private func decodedPayload(_ operation: OutboxOperation) throws -> DecodedGardenPayload {
        try JSONDecoder().decode(DecodedGardenPayload.self, from: Data(operation.payload.utf8))
    }

    // MARK: - CreateGarden

    @Test("CreateGarden writes a local projection and a gardens.create outbox row")
    func createGardenOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let createGarden = CreateGarden(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" },
            generateGardenId: { "garden-1" }
        )

        let result = try await createGarden(name: "  Backyard  ")

        #expect(result.id == "garden-1")
        #expect(result.name == "Backyard")
        #expect(result.lifecycleState == .active)
        #expect(result.callerRole == .owner)

        let stored = try await store.fetchAll()
        #expect(stored == [result])

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operations.count == 1)
        #expect(operation.id == "operation-1")
        #expect(operation.profileId == "profile-1")
        #expect(operation.gardenId == "garden-1")
        #expect(operation.commandType == "gardens.create")
        #expect(operation.commandVersion == 1)
        #expect(operation.targetRecordIds == ["garden-1"])
        #expect(operation.expectedRevision == nil)
        #expect(operation.localSequence == 1)

        let payload = try decodedPayload(operation)
        #expect(payload.recordType == "garden")
        #expect(payload.gardenId == "garden-1")
        #expect(payload.command.commandType == "gardens.create")
        #expect(payload.command.expectedRevision == nil)
        #expect(payload.command.request?.name == "Backyard")
    }

    @Test("CreateGarden rejects an empty name without writing anything")
    func createGardenRejectsEmptyName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let createGarden = CreateGarden(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await createGarden(name: "   ")
        }

        #expect(failure == .invalidName)
        #expect(try await store.fetchAll().isEmpty)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("CreateGarden rejects a name longer than 120 characters")
    func createGardenRejectsTooLongName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let createGarden = CreateGarden(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await createGarden(name: String(repeating: "a", count: 121))
        }

        #expect(failure == .invalidName)
    }

    // MARK: - RenameGarden

    @Test("RenameGarden writes a local projection and a gardens.rename outbox row")
    func renameGardenOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // Seed a server-confirmed garden, as `GetGarden`/`ListGardens` would.
        let original = garden(id: "garden-1", revision: 4)
        try await store.save(original)

        let renameGarden = RenameGarden(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 2_000) },
            generateOperationId: { "operation-2" }
        )

        let result = try await renameGarden(gardenId: "garden-1", name: "Front Yard", expectedRevision: 4)

        #expect(result.name == "Front Yard")
        // Unchanged locally: the server, not this client, assigns the new
        // revision, which this device only learns once the push that
        // consumes this outbox operation is accepted.
        #expect(result.revision == 4)
        #expect(result.lifecycleState == .active)
        #expect(result.createdAt == original.createdAt)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "gardens.rename")
        #expect(operation.expectedRevision == 4)
        #expect(operation.gardenId == "garden-1")

        let payload = try decodedPayload(operation)
        #expect(payload.command.commandType == "gardens.rename")
        #expect(payload.command.expectedRevision == 4)
        #expect(payload.command.request?.name == "Front Yard")
    }

    @Test("RenameGarden fails locally when this device has no local record for the garden")
    func renameGardenWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let renameGarden = RenameGarden(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await renameGarden(gardenId: "unknown-garden", name: "New Name", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("RenameGarden rejects an empty name without writing anything")
    func renameGardenRejectsEmptyName() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        try await store.save(garden(id: "garden-1", revision: 1))
        let renameGarden = RenameGarden(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await renameGarden(gardenId: "garden-1", name: "  ", expectedRevision: 1)
        }

        #expect(failure == .invalidName)
        #expect(try await store.fetchAll().first?.name == "Backyard")
    }

    // MARK: - ArchiveGarden

    @Test("ArchiveGarden transitions lifecycleState locally and writes a gardens.archive outbox row")
    func archiveGardenOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        try await store.save(garden(id: "garden-1", revision: 2))

        let archiveGarden = ArchiveGarden(
            localStore: store,
            profileId: "profile-1",
            generateOperationId: { "operation-3" }
        )

        let result = try await archiveGarden(gardenId: "garden-1", expectedRevision: 2)

        #expect(result.lifecycleState == .archived)
        #expect(result.name == "Backyard")
        #expect(result.revision == 2)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "gardens.archive")
        #expect(operation.expectedRevision == 2)

        let payload = try decodedPayload(operation)
        #expect(payload.command.commandType == "gardens.archive")
        #expect(payload.command.expectedRevision == 2)
        #expect(payload.command.request == nil)
    }

    @Test("ArchiveGarden fails locally when this device has no local record for the garden")
    func archiveGardenWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let archiveGarden = ArchiveGarden(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await archiveGarden(gardenId: "unknown-garden", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
    }

    // MARK: - RequestGardenDeletion

    @Test("RequestGardenDeletion transitions lifecycleState locally and writes a gardens.delete_request outbox row")
    func requestGardenDeletionOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        try await store.save(garden(id: "garden-1", revision: 5))

        let requestGardenDeletion = RequestGardenDeletion(
            localStore: store,
            profileId: "profile-1",
            generateOperationId: { "operation-4" }
        )

        let result = try await requestGardenDeletion(gardenId: "garden-1", expectedRevision: 5)

        #expect(result.lifecycleState == .deletionRequested)
        #expect(result.revision == 5)

        let operation = try #require(try await outbox.fetchAll().first)
        // Not "gardens.requestDeletion" — the contract's discriminator value
        // is `gardens.delete_request`
        // (`SyncRequestGardenDeletionCommand.commandType.enum`).
        #expect(operation.commandType == "gardens.delete_request")
        #expect(operation.expectedRevision == 5)

        let payload = try decodedPayload(operation)
        #expect(payload.command.commandType == "gardens.delete_request")
        #expect(payload.command.expectedRevision == 5)
        #expect(payload.command.request == nil)
    }

    @Test("RequestGardenDeletion fails locally when this device has no local record for the garden")
    func requestGardenDeletionWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let requestGardenDeletion = RequestGardenDeletion(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: GardenCommandError.self) {
            try await requestGardenDeletion(gardenId: "unknown-garden", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
    }
}
