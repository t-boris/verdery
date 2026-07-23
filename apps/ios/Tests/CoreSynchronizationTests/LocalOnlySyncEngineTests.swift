import CoreDomain
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// Exercises `CorePersistence`'s local storage through the realistic, if
/// currently no-op-networked, shape `SyncEngine` provides — this work
/// package's own tests can run against a stable seam a later stage's
/// network-backed engine will also implement.
@Suite("Local-only sync engine")
struct LocalOnlySyncEngineTests {
    @Test("pushPending reads the local outbox without throwing, and submits nothing")
    func pushPendingReadsOutboxWithoutSubmitting() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(
            OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "createObject",
                commandVersion: 1, targetRecordIds: [], expectedRevision: nil, payload: "{}",
                createdAt: Date()
            )
        )
        let engine = LocalOnlySyncEngine(outboxStore: outboxStore)

        try await engine.pushPending()

        // No network call was made, and the operation is still pending —
        // a `LocalOnlySyncEngine` never resolves an operation's outcome.
        let stillPending = try await outboxStore.fetchAll()
        #expect(stillPending.map(\.id) == ["op-1"])
    }

    @Test("pullChanges is a genuine no-op")
    func pullChangesIsNoOp() async throws {
        let engine = LocalOnlySyncEngine(outboxStore: InMemorySyncOutboxStore())

        try await engine.pullChanges()
    }
}
