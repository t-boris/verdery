import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Sync operation result store")
struct SyncOperationResultStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    @Test("record upserts: a later result for the same operation replaces the prior one")
    func recordUpsertsBySameOperationId() async throws {
        let store = GRDBSyncOperationResultStore(dbQueue: try makeDatabase())

        try await store.record(
            SyncOperationResult(
                operationId: "op-1",
                gardenId: "garden-1",
                outcome: .retryLater,
                receivedAt: Date(timeIntervalSince1970: 0)
            )
        )
        try await store.record(
            SyncOperationResult(
                operationId: "op-1",
                gardenId: "garden-1",
                outcome: .accepted,
                serverRevision: 5,
                receivedAt: Date(timeIntervalSince1970: 10)
            )
        )

        let result = try await store.result(forOperation: "op-1")
        #expect(result?.outcome == .accepted)
        #expect(result?.serverRevision == 5)

        let all = try await store.fetchAll(gardenId: "garden-1")
        #expect(all.count == 1)
    }

    @Test("A conflict result links back to its conflict record")
    func conflictResultCarriesConflictId() async throws {
        let store = GRDBSyncOperationResultStore(dbQueue: try makeDatabase())

        try await store.record(
            SyncOperationResult(
                operationId: "op-1",
                gardenId: "garden-1",
                outcome: .conflict,
                conflictId: "conflict-1",
                receivedAt: Date()
            )
        )

        let result = try await store.result(forOperation: "op-1")
        #expect(result?.conflictId == "conflict-1")
    }

    @Test("fetchAll scopes to one garden, most recently received first")
    func fetchAllScopesToGardenAndOrdersByRecency() async throws {
        let store = GRDBSyncOperationResultStore(dbQueue: try makeDatabase())
        try await store.record(
            SyncOperationResult(
                operationId: "op-a", gardenId: "garden-1", outcome: .accepted,
                receivedAt: Date(timeIntervalSince1970: 0)
            )
        )
        try await store.record(
            SyncOperationResult(
                operationId: "op-b", gardenId: "garden-1", outcome: .accepted,
                receivedAt: Date(timeIntervalSince1970: 100)
            )
        )
        try await store.record(
            SyncOperationResult(
                operationId: "op-c", gardenId: "garden-2", outcome: .accepted,
                receivedAt: Date(timeIntervalSince1970: 50)
            )
        )

        let results = try await store.fetchAll(gardenId: "garden-1")

        #expect(results.map(\.operationId) == ["op-b", "op-a"])
    }
}
