import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Sync conflict store")
struct SyncConflictStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func conflict(
        id: String = "conflict-1",
        gardenId: String = "garden-1",
        resolutionOperationId: String? = nil
    ) -> SyncConflict {
        SyncConflict(
            id: id,
            originalOperationId: "op-1",
            gardenId: gardenId,
            conflictCode: "staleRevision",
            localRepresentation: #"{"name":"Local"}"#,
            serverRepresentation: #"{"name":"Server"}"#,
            suggestedRecoveryActions: [.keepServerVersion, .reapplyLocalIntent],
            resolutionOperationId: resolutionOperationId,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("record round-trips every field, including the recovery action list")
    func recordRoundTripsFields() async throws {
        let store = GRDBSyncConflictStore(dbQueue: try makeDatabase())
        try await store.record(conflict())

        let open = try await store.fetchOpen(gardenId: "garden-1")

        #expect(open == [conflict()])
        #expect(open.first?.suggestedRecoveryActions == [.keepServerVersion, .reapplyLocalIntent])
    }

    @Test("fetchOpen excludes resolved conflicts and other gardens")
    func fetchOpenExcludesResolvedAndOtherGardens() async throws {
        let store = GRDBSyncConflictStore(dbQueue: try makeDatabase())
        try await store.record(conflict(id: "open-1", gardenId: "garden-a"))
        try await store.record(conflict(id: "resolved-1", gardenId: "garden-a", resolutionOperationId: "op-resolved"))
        try await store.record(conflict(id: "other-garden", gardenId: "garden-b"))

        let open = try await store.fetchOpen(gardenId: "garden-a")

        #expect(open.map(\.id) == ["open-1"])
    }

    @Test("resolve marks the conflict resolved and preserves the rest of its data")
    func resolveMarksConflictResolved() async throws {
        let store = GRDBSyncConflictStore(dbQueue: try makeDatabase())
        try await store.record(conflict(id: "conflict-1"))

        try await store.resolve(
            conflictId: "conflict-1",
            resolutionOperationId: "resolution-op",
            at: Date(timeIntervalSince1970: 200)
        )

        let stillOpen = try await store.fetchOpen(gardenId: "garden-1")
        #expect(stillOpen.isEmpty)
    }

    @Test("remove deletes the conflict record")
    func removeDeletesConflict() async throws {
        let store = GRDBSyncConflictStore(dbQueue: try makeDatabase())
        try await store.record(conflict(id: "conflict-1"))

        try await store.remove(conflictId: "conflict-1")

        let open = try await store.fetchOpen(gardenId: "garden-1")
        #expect(open.isEmpty)
    }
}
