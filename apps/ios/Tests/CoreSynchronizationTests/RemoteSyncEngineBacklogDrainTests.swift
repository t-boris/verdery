import CoreDomain
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import CoreSynchronization

/// "Large backlog with bounded memory" (architecture/offline-
/// synchronization.md, section "24. Testing Matrix") for the push side of
/// the client engine, at real "hundreds+" scale, against the real
/// `GRDBSyncOutboxStore` (not the in-memory fake `RemoteSyncEngineTests`
/// otherwise uses) — a separate file from `RemoteSyncEngineTests.swift`
/// (already close to this repository's 600-line file-size limit), matching
/// this suite's own established split-by-concern precedent.
///
/// `RemoteSyncEngineTests.pushBoundsBatchSize` already proves ONE
/// `pushPending()` call never sends more than `RemoteSyncEngine.maxBatchSize`
/// operations over the wire. What that test does not prove — and what this
/// file adds — is that the backlog left over after that first bounded call
/// does not simply sit there: repeated `pushPending()` calls, the same
/// trigger a real foreground/background/explicit-retry cycle already
/// provides (see `RemoteSyncEngine.swift`'s own header comment: "a caller
/// repeatedly invoking `pushPending()`... already accomplishes across
/// calls"), fully drain a backlog many times larger than one batch, each
/// call still bounded, none silently dropped or duplicated.
@Suite("Remote sync engine — large backlog drain (push)")
struct RemoteSyncEngineBacklogDrainTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func operation(id: String, localSequence: Int64) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "gardens.create",
            commandVersion: 1,
            targetRecordIds: ["garden-\(id)"],
            expectedRevision: nil,
            payload: #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.create"}}"#,
            localSequence: localSequence,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("Repeated pushPending() calls fully drain a backlog several times larger than one bounded batch, each call still bounded to maxBatchSize")
    func repeatedCallsDrainALargeBacklog() async throws {
        let dbQueue = try makeDatabase()
        let outboxStore = GRDBSyncOutboxStore(dbQueue: dbQueue)
        // Two full batches plus a partial third — large enough that a single
        // call structurally cannot drain it, and not evenly divisible by
        // `maxBatchSize`, so the final call's own shorter batch is exercised
        // too.
        let backlogSize = RemoteSyncEngine.maxBatchSize * 2 + 137
        for index in 0..<backlogSize {
            try await outboxStore.enqueue(operation(id: "op-\(index)", localSequence: Int64(index)))
        }

        let gateway = FakeDrainGateway()
        await gateway.setAcceptEverything()
        let engine = RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [FakeDrainApplier(recordType: "garden")],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )

        var callCount = 0
        var remaining = try await outboxStore.fetchAll().count
        // A bounded loop, not an unconditional one: a real defect that
        // stopped the backlog from ever shrinking must fail this test rather
        // than hang the suite.
        while remaining > 0, callCount <= 10 {
            try await engine.pushPending()
            callCount += 1
            remaining = try await outboxStore.fetchAll().count
        }
        #expect(callCount <= 10, "the backlog did not drain within a reasonable number of calls")

        #expect(try await outboxStore.fetchAll().isEmpty)
        // Exactly three calls: two full `maxBatchSize` batches, then the
        // 137-item remainder.
        #expect(callCount == 3)
        let batchSizes = await gateway.pushedBatchSizes
        #expect(batchSizes == [RemoteSyncEngine.maxBatchSize, RemoteSyncEngine.maxBatchSize, 137])

        // Every one of the original operation ids was actually submitted —
        // proof the drain neither dropped nor duplicated any of them across
        // the three bounded calls.
        let submittedIds = await gateway.allSubmittedOperationIds
        #expect(Set(submittedIds).count == backlogSize)
        #expect(submittedIds.count == backlogSize)
    }
}

private actor FakeDrainGateway: SyncGateway {
    private(set) var pushedBatchSizes: [Int] = []
    private(set) var allSubmittedOperationIds: [String] = []
    private var acceptEverything = false

    func setAcceptEverything() {
        acceptEverything = true
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        pushedBatchSizes.append(operations.count)
        allSubmittedOperationIds.append(contentsOf: operations.map(\.id))
        guard acceptEverything else { return [] }
        return operations.map {
            .accepted(operationId: $0.id, recordRevisions: [SyncRecordReference(recordId: $0.gardenId, recordType: "garden", revision: 1)])
        }
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
    }
}

private actor FakeDrainApplier: SyncRecordApplier {
    nonisolated let recordType: String

    init(recordType: String) {
        self.recordType = recordType
    }

    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}

    func removeGardenScopedData(gardenId: String) async throws {}
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    let id: String

    func currentOrGenerated() async throws -> String { id }
}
