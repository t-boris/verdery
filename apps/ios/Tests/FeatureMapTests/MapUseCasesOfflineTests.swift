import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureMap

/// Coverage for `ApplyMapCommandOffline` against a real GRDB database, per
/// architecture/offline-synchronization.md, section "6. Local Mutation
/// Transaction" — the P5-IOS-02 (Stage 4b) counterpart to
/// `FeatureGardensTests.GardensUseCasesTests`.
///
/// None of these tests configure a `MapGateway` at all — `ApplyMapCommandOffline`
/// does not accept one — so a passing suite is itself evidence that applying
/// a map command while offline never attempts a network call. Covers create,
/// move, delete, and split specifically (per this stage's own scope note:
/// split/join have real structural complexity worth a dedicated check), plus
/// join and a local validation failure.
@Suite("Map use cases (offline)")
struct MapUseCasesOfflineTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func tree(id: String, revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func fence(id: String, points: [Position], revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .fence,
            geometry: .lineString(points),
            coordinateSpaceId: "space-1",
            label: "Back fence",
            categoryDetails: .fence(FenceDetails(fenceKind: .wood)),
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Decodes an outbox row's stored `payload` as loose JSON, so a test can
    /// assert it matches `packages/api-contracts/openapi.yaml`'s
    /// `SyncGardenObjectOperationPayload`/`MapCommandPayload` field-for-field
    /// without needing a real server or the generated OpenAPI models —
    /// mirrors `GardensUseCasesTests.decodedPayload`'s purpose, using a loose
    /// dictionary instead of a fixed mirror type since `command`'s own shape
    /// varies per one of 13 discriminated branches.
    private func decodedPayloadJSON(_ operation: OutboxOperation) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(operation.payload.utf8))
        return try #require(object as? [String: Any])
    }

    // MARK: - createObject

    @Test("createObject writes a local projection and a map.createObject outbox row, wire-shaped flat categoryDetails")
    func createObjectOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" }
        )

        let command = MapCommandPayload.createObject(
            CreateObjectPayload(
                objectId: "tree-1",
                category: .tree,
                geometry: .point(Position(x: 3, y: 4)),
                label: "New Oak",
                categoryDetails: .tree(TreeDetails(commonName: "Quercus"))
            )
        )

        let affected = try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)

        #expect(affected.map(\.id) == ["tree-1"])
        #expect(affected.first?.revision == 0)
        #expect(affected.first?.coordinateSpaceId == "space-1")

        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(stored == affected)

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operations.count == 1)
        #expect(operation.commandType == "map.createObject")
        #expect(operation.commandVersion == 1)
        #expect(operation.targetRecordIds == ["tree-1"])
        #expect(operation.expectedRevision == nil)

        let json = try decodedPayloadJSON(operation)
        #expect(json["recordType"] as? String == "gardenObject")
        #expect(json["gardenId"] as? String == "garden-1")
        let command2 = try #require(json["command"] as? [String: Any])
        #expect(command2["type"] as? String == "createObject")
        #expect(command2["objectId"] as? String == "tree-1")
        // `categoryDetails` is flat on the wire — `category` sits alongside
        // its own fields in the same object, not nested under a `details`
        // key the way `MapCommandCoding.swift`'s domain-shaped conformance
        // would produce (see `MapCommandWireCoding`'s doc comment).
        let categoryDetails = try #require(command2["categoryDetails"] as? [String: Any])
        #expect(categoryDetails["category"] as? String == "tree")
        #expect(categoryDetails["commonName"] as? String == "Quercus")
        #expect(categoryDetails["details"] == nil)
    }

    // MARK: - moveObject

    @Test("moveObject translates the object's geometry and writes a map.moveObject outbox row")
    func moveObjectOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [tree(id: "tree-1", revision: 3)])
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 2_000) },
            generateOperationId: { "operation-2" }
        )

        let command = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "tree-1", expectedRevision: 3, translationMetres: PlanarOffset(dx: 5, dy: -2))
        )

        let affected = try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)

        let moved = try #require(affected.first)
        #expect(affected.count == 1)
        guard case let .point(position) = moved.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        #expect(position == Position(x: 5, y: -2))
        // The local projection never invents a new revision — it must stay
        // exactly what the last confirmed server revision was, so the next
        // locally-queued command still quotes a revision the server actually
        // has. See `MapCommandProjection`'s own doc comment.
        #expect(moved.revision == 3)

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operation.commandType == "map.moveObject")
        #expect(operation.expectedRevision == 3)
        #expect(operation.targetRecordIds == ["tree-1"])

        let json = try decodedPayloadJSON(operation)
        let command2 = try #require(json["command"] as? [String: Any])
        #expect(command2["type"] as? String == "moveObject")
        let translation = try #require(command2["translationMetres"] as? [String: Any])
        #expect(translation["dx"] as? Double == 5)
        #expect(translation["dy"] as? Double == -2)
    }

    // MARK: - deleteObject

    @Test("deleteObject soft-deletes locally and writes a map.deleteObject outbox row")
    func deleteObjectOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [tree(id: "tree-1", revision: 1)])
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(localStore: store, profileId: "profile-1", generateOperationId: { "operation-3" })

        let command = MapCommandPayload.deleteObject(DeleteObjectPayload(objectId: "tree-1", expectedRevision: 1))
        let affected = try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)

        #expect(affected.first?.lifecycleState == .deleted)
        // Still present in the local table, not row-deleted — soft delete,
        // matching the backend's own `deleteObject` semantics.
        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(stored.first?.lifecycleState == .deleted)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "map.deleteObject")
        let json = try decodedPayloadJSON(operation)
        let command2 = try #require(json["command"] as? [String: Any])
        #expect(command2["type"] as? String == "deleteObject")
        #expect(command2["expectedRevision"] as? Int == 1)
    }

    // MARK: - splitLinework

    @Test("splitLinework soft-deletes the original and creates two new pieces, with one map.splitLinework outbox row")
    func splitLineworkOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let original = fence(
            id: "fence-1", points: [Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 20, y: 0)], revision: 2
        )
        try await store.replaceAll(gardenId: "garden-1", with: [original])
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(localStore: store, profileId: "profile-1", generateOperationId: { "operation-4" })

        let command = MapCommandPayload.splitLinework(
            SplitLineworkPayload(
                objectId: "fence-1",
                expectedRevision: 2,
                resultObjectIds: SplitResultObjectIds(first: "piece-a", second: "piece-b"),
                atVertexIndex: 1
            )
        )

        let affected = try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)

        // Matches the backend's own `affectedObjects` order and membership
        // exactly (`SplitMapObjectLinework.execute`): the deleted original,
        // then the two new pieces — three objects, not two.
        #expect(affected.count == 3)
        #expect(Set(affected.map(\.id)) == ["fence-1", "piece-a", "piece-b"])
        #expect(affected.first { $0.id == "fence-1" }?.lifecycleState == .deleted)
        let pieceA = try #require(affected.first { $0.id == "piece-a" })
        let pieceB = try #require(affected.first { $0.id == "piece-b" })
        #expect(pieceA.lifecycleState == .active)
        #expect(pieceA.revision == 0)
        #expect(pieceA.categoryDetails == original.categoryDetails)
        guard case let .lineString(pieceALine) = pieceA.geometry, case let .lineString(pieceBLine) = pieceB.geometry else {
            Issue.record("Expected LineString geometry for both pieces")
            return
        }
        #expect(pieceALine == [Position(x: 0, y: 0), Position(x: 10, y: 0)])
        #expect(pieceBLine == [Position(x: 10, y: 0), Position(x: 20, y: 0)])

        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(Set(stored.map(\.id)) == ["fence-1", "piece-a", "piece-b"])

        let operations = try await outbox.fetchAll()
        #expect(operations.count == 1)
        let operation = try #require(operations.first)
        #expect(operation.commandType == "map.splitLinework")
        #expect(Set(operation.targetRecordIds) == ["fence-1", "piece-a", "piece-b"])

        let json = try decodedPayloadJSON(operation)
        let command2 = try #require(json["command"] as? [String: Any])
        #expect(command2["type"] as? String == "splitLinework")
        #expect(command2["resultObjectIds"] as? [String] == ["piece-a", "piece-b"])
        #expect(command2["atVertexIndex"] as? Int == 1)
    }

    // MARK: - joinLinework

    @Test("joinLinework soft-deletes both sources and creates one joined object")
    func joinLineworkOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let first = fence(id: "fence-a", points: [Position(x: 0, y: 0), Position(x: 10, y: 0)], revision: 1)
        let second = fence(id: "fence-b", points: [Position(x: 10, y: 0), Position(x: 20, y: 0)], revision: 1)
        try await store.replaceAll(gardenId: "garden-1", with: [first, second])
        let apply = ApplyMapCommandOffline(localStore: store, profileId: "profile-1", generateOperationId: { "operation-5" })

        let command = MapCommandPayload.joinLinework(
            JoinLineworkPayload(
                firstObjectId: "fence-a",
                firstExpectedRevision: 1,
                secondObjectId: "fence-b",
                secondExpectedRevision: 1,
                resultObjectId: "fence-joined"
            )
        )

        let affected = try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)

        #expect(affected.count == 3)
        #expect(affected.first { $0.id == "fence-a" }?.lifecycleState == .deleted)
        #expect(affected.first { $0.id == "fence-b" }?.lifecycleState == .deleted)
        let joined = try #require(affected.first { $0.id == "fence-joined" })
        #expect(joined.lifecycleState == .active)
        guard case let .lineString(joinedLine) = joined.geometry else {
            Issue.record("Expected LineString geometry")
            return
        }
        // The shared (10, 0) vertex is not duplicated.
        #expect(joinedLine == [Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 20, y: 0)])
    }

    // MARK: - Local validation failure

    @Test("A command targeting an object with no local row throws objectNotFound and writes nothing")
    func missingObjectWritesNothing() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(localStore: store, profileId: "profile-1", generateOperationId: { "operation-6" })

        let command = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "missing", expectedRevision: 1, translationMetres: PlanarOffset(dx: 1, dy: 1))
        )

        let failure = await #expect(throws: MapCommandError.self) {
            try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)
        }
        #expect(failure == .objectNotFound(objectId: "missing"))

        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await outbox.fetchAll().isEmpty)
    }

    @Test("upsertCalibration reaches this store as unsupportedCommand — no real caller today, but a safe defensive failure if one appears")
    func upsertCalibrationIsUnsupported() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let apply = ApplyMapCommandOffline(localStore: store, profileId: "profile-1", generateOperationId: { "operation-7" })

        let command = MapCommandPayload.upsertCalibration(
            UpsertCalibrationPayload(
                backgroundObjectId: "background-1",
                referencePoints: [CalibrationReferencePoint(imagePixel: Position(x: 0, y: 0), localMetres: Position(x: 0, y: 0))]
            )
        )

        let failure = await #expect(throws: MapCommandError.self) {
            try await apply(gardenId: "garden-1", coordinateSpaceId: "space-1", command: command)
        }
        #expect(failure == .unsupportedCommand)
    }
}
