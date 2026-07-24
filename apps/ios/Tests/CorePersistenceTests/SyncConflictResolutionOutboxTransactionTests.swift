import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

/// The mechanism-level proof `RemoteSyncEngine+ConflictResolution.swift`'s
/// own fix for the P5-QA-01 transaction-atomicity defect rests on:
/// `GRDBSyncConflictResolutionOutboxTransaction.run(_:)` really does commit
/// an outbox removal, an outbox enqueue, and a conflict resolution as one
/// real GRDB transaction — not three independent writes a crash could land
/// between.
@Suite("Sync conflict-resolution outbox transaction")
struct SyncConflictResolutionOutboxTransactionTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func operation(id: String, gardenId: String = "garden-1") -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "gardens.rename",
            commandVersion: 1,
            targetRecordIds: ["garden-1"],
            expectedRevision: 3,
            payload: #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.rename"}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func conflict(id: String = "conflict-1", originalOperationId: String) -> SyncConflict {
        SyncConflict(
            id: id,
            originalOperationId: originalOperationId,
            gardenId: "garden-1",
            recordType: "garden",
            conflictCode: "staleRevision",
            localRepresentation: "{}",
            serverRepresentation: "{}",
            suggestedRecoveryActions: [.reapplyLocalIntent, .openForManualReview],
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("run() commits the outbox removal, the new operation's enqueue, and the conflict's resolution together")
    func commitsAllThreeWritesTogether() async throws {
        let dbQueue = try makeDatabase()
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let conflictStore = GRDBSyncConflictStore(dbQueue: dbQueue)
        try await outbox.enqueue(operation(id: "op-original"))
        try await conflictStore.record(conflict(originalOperationId: "op-original"))
        let transaction = GRDBSyncConflictResolutionOutboxTransaction(dbQueue: dbQueue)

        try await transaction.run { context in
            try context.removeOutboxOperation(operationId: "op-original")
            try context.enqueueOutboxOperation(self.operation(id: "op-resolution"))
            try context.resolveConflict(conflictId: "conflict-1", resolutionOperationId: "op-resolution", at: Date(timeIntervalSince1970: 100))
        }

        #expect(try await outbox.fetch(operationId: "op-original") == nil)
        #expect(try await outbox.fetch(operationId: "op-resolution") != nil)
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").isEmpty)
    }

    /// The real technique this fix's own safety rests on: a genuine GRDB
    /// constraint violation (a duplicate `sync_outbox.id`, a primary key)
    /// forced on the SECOND write inside `run(_:)` must roll back the FIRST
    /// write too — the same "force a real failure, not a test-only hook"
    /// technique `FeatureMapTests.MapOfflineMutationTests
    /// .outboxFailureRollsBackProjections` already establishes for
    /// `commitOfflineMutation`. This test would have passed trivially before
    /// this stage's fix existed (there was no `run(_:)` to call at all) —
    /// its value is proving the NEW mechanism is genuinely atomic, the
    /// foundation `RemoteSyncEngineConflictResolutionTransactionTests`'
    /// own behavioral proof (in `CoreSynchronizationTests`) builds on.
    @Test("A failure partway through run() rolls back every write already made inside it, not just the one that failed")
    func partialFailureRollsBackEverything() async throws {
        let dbQueue = try makeDatabase()
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let conflictStore = GRDBSyncConflictStore(dbQueue: dbQueue)
        try await outbox.enqueue(operation(id: "op-original"))
        try await conflictStore.record(conflict(originalOperationId: "op-original"))
        // A real prior row already occupying the id the transaction's own
        // enqueue below will try to reuse — forces a genuine primary-key
        // violation, not a simulated one.
        try await outbox.enqueue(operation(id: "op-resolution", gardenId: "garden-0"))
        let transaction = GRDBSyncConflictResolutionOutboxTransaction(dbQueue: dbQueue)

        await #expect(throws: (any Error).self) {
            try await transaction.run { context in
                try context.removeOutboxOperation(operationId: "op-original")
                try context.enqueueOutboxOperation(self.operation(id: "op-resolution"))
                try context.resolveConflict(conflictId: "conflict-1", resolutionOperationId: "op-resolution", at: Date(timeIntervalSince1970: 100))
            }
        }

        // The removal that ran FIRST, inside the same transaction as the
        // failed enqueue, must not have survived independently — if it had,
        // this is exactly the pre-fix `originalOperationMissing` dead end.
        #expect(
            try await outbox.fetch(operationId: "op-original") != nil,
            "the original operation must still be present — its removal must have rolled back with the failed enqueue"
        )
        #expect(
            try await conflictStore.fetchOpen(gardenId: "garden-1").count == 1,
            "the conflict must still show as open — resolve() inside the same failed transaction must have rolled back too"
        )
    }
}
