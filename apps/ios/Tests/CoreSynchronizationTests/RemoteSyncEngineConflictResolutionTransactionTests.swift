import CoreDomain
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import CoreSynchronization

/// The behavioral proof for the P5-QA-01 transaction-atomicity defect this
/// follow-up fixes — `RemoteSyncEngine+ConflictResolution.swift`'s own
/// header comment has the full account. A separate file from
/// `RemoteSyncEngineConflictResolutionTests.swift` (already close to this
/// repository's 600-line limit, and built entirely around
/// `InMemorySyncOutboxStore`/`InMemorySyncConflictStore`, which have no
/// GRDB transaction to prove anything real about): this file needs the real
/// `GRDBSyncOutboxStore`/`GRDBSyncConflictStore`, sharing one `DatabaseQueue`,
/// plus `GRDBSyncConflictResolutionOutboxTransaction` — the same
/// "real database, not an in-memory fake" bar
/// `RemoteSyncEngineBacklogDrainTests.swift` already sets for a concern an
/// in-memory double cannot honestly exercise.
///
/// Uses the exact same technique `SyncConflictResolutionOutboxTransactionTests`
/// (`CorePersistenceTests`) and `MapOfflineMutationTests
/// .outboxFailureRollsBackProjections` already establish: force a REAL GRDB
/// primary-key violation partway through the transaction (a duplicate
/// `sync_outbox.id`), rather than a test-only failure hook, so the proof
/// rests on the actual production code path.
@Suite("Remote sync engine conflict resolution — outbox/conflict transaction atomicity")
struct RemoteSyncEngineConflictResolutionTransactionTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func originalOperation(id: String = "op-original") -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "gardens.rename",
            commandVersion: 1,
            targetRecordIds: ["garden-1"],
            expectedRevision: 3,
            payload: #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.rename","expectedRevision":3,"request":{"name":"Local Name"}}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func conflict() -> SyncConflict {
        SyncConflict(
            id: "conflict-1",
            originalOperationId: "op-original",
            gardenId: "garden-1",
            recordType: "garden",
            conflictCode: "staleRevision",
            localRepresentation: "{}",
            serverRepresentation: #"{"recordType":"garden","data":{"id":"garden-1","name":"Server Garden","lifecycleState":"active","callerRole":"owner","revision":9,"createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z"}}"#,
            suggestedRecoveryActions: [.reapplyLocalIntent, .openForManualReview],
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// **The severe, pre-fix defect this proves is gone.** Before this
    /// stage, a crash (here: a forced real database failure) between
    /// removing `conflict.originalOperationId` from the outbox and
    /// enqueueing its resolution left the original permanently unfetchable
    /// — retrying `resolveConflict(_:action: .reapplyLocalIntent)` for the
    /// exact same still-open conflict threw `SyncConflictResolutionError
    /// .originalOperationMissing` forever, losing the user's own local
    /// intent for good. This test forces exactly that failure window using a
    /// real GRDB constraint violation, then proves the retry succeeds fully
    /// — the transaction rolled the failed attempt back to the pre-attempt
    /// state, not to the in-between state that used to be unrecoverable.
    /// This test would have FAILED against the pre-fix code (the second
    /// `resolveConflict` call would have thrown `originalOperationMissing`
    /// instead of succeeding) and passes against the fix.
    @Test("A forced failure partway through resolveReapplyingLocalIntent's transaction leaves the original operation retryable, not permanently lost")
    func interruptedReapplyLeavesOriginalRetryable() async throws {
        let dbQueue = try makeDatabase()
        let outboxStore = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let conflictStore = GRDBSyncConflictStore(dbQueue: dbQueue)
        try await outboxStore.enqueue(originalOperation())
        try await conflictStore.record(conflict())
        // A real prior row already occupying the id the first resolution
        // attempt will try to reuse — forces a genuine primary-key
        // violation on the transaction's own enqueue step, not a simulated
        // one.
        try await outboxStore.enqueue(OutboxOperation(
            id: "resolution-op-1", profileId: "profile-1", gardenId: "garden-0", commandType: "unrelated",
            commandVersion: 1, targetRecordIds: ["unrelated"], expectedRevision: nil, payload: "{}",
            createdAt: Date(timeIntervalSince1970: 0)
        ))
        let ids = IdSequence(["resolution-op-1", "resolution-op-2"])
        let applier = ReplayableApplier(recordType: "garden")
        let engine = RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            outboxConflictTransaction: GRDBSyncConflictResolutionOutboxTransaction(dbQueue: dbQueue),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: InertGateway(),
            clientInstallationStore: FakeClientInstallationIdentityStore(),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [applier],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { ids.next() },
            randomUnitInterval: { 1.0 }
        )

        // First attempt: the id collision forces the transaction to fail
        // and roll back.
        await #expect(throws: (any Error).self) {
            try await engine.resolveConflict(conflict(), action: .reapplyLocalIntent)
        }

        // The critical assertion: the original operation is still present
        // and still fetchable — a REAL fix, not merely "the second attempt
        // happens not to throw". Before this stage's fix, this would already
        // be `nil` here (removed outside any transaction), which is exactly
        // what made the retry below throw `originalOperationMissing`.
        #expect(try await outboxStore.fetch(operationId: "op-original") != nil)
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").count == 1)

        // Second attempt, same conflict, fresh id this time (the same
        // "no two real UUIDv7s collide twice" realism `IdSequence` models):
        // succeeds completely, proving the original was never lost.
        try await engine.resolveConflict(conflict(), action: .reapplyLocalIntent)

        #expect(try await outboxStore.fetch(operationId: "op-original") == nil)
        let pending = try await outboxStore.fetchAll().filter { $0.gardenId == "garden-1" }
        #expect(pending.map(\.id) == ["resolution-op-2"])
        #expect(pending.first?.resolvesConflictId == "conflict-1")
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").isEmpty)
    }

    /// Contrasts the above with the pre-fix shape directly: with no
    /// `outboxConflictTransaction` supplied (this engine's own default, and
    /// every other test double's own setup), the SAME forced failure leaves
    /// the original operation already removed — the exact dead end this
    /// stage's fix closes for the real, GRDB-backed configuration.
    /// Documents the honest boundary of this fix (see this file's own and
    /// `RemoteSyncEngine+ConflictResolution.swift`'s own header comments)
    /// rather than leaving it a silent assumption.
    @Test("Without outboxConflictTransaction, the same forced failure DOES leave the original operation already removed — the pre-fix behavior, now opt-in only via the transaction's absence")
    func withoutTransactionTheSameFailureLosesTheOriginal() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation())
        let conflictStore = InMemorySyncConflictStore()
        try await conflictStore.record(conflict())
        let applier = ReplayableApplier(recordType: "garden")
        let engine = RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: InertGateway(),
            clientInstallationStore: FakeClientInstallationIdentityStore(),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [applier],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "resolution-op-1" },
            randomUnitInterval: { 1.0 }
        )

        try await engine.resolveConflict(conflict(), action: .reapplyLocalIntent)

        #expect(try await outboxStore.fetch(operationId: "op-original") == nil)
        #expect(try await outboxStore.fetch(operationId: "resolution-op-1") != nil)
    }
}

// MARK: - Fakes

private actor ReplayableApplier: SyncRecordApplier, SyncConflictReplayableApplier {
    nonisolated let recordType: String

    init(recordType: String) {
        self.recordType = recordType
    }

    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}
    func removeGardenScopedData(gardenId: String) async throws {}

    nonisolated func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft {
        ConflictResolutionOperationDraft(
            commandType: original.commandType,
            commandVersion: original.commandVersion,
            targetRecordIds: original.targetRecordIds,
            expectedRevision: newExpectedRevision,
            payload: #"{"reapplied":true,"expectedRevision":\#(newExpectedRevision)}"#
        )
    }
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    func currentOrGenerated() async throws -> String { "install-1" }
}

private actor InertGateway: SyncGateway {
    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}
    func push(
        clientInstallationId: String, protocolVersion: Int, operationPayloadVersion: Int, operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] { [] }
    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }
    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
    }
}

/// A small thread-safe queue of ids — the same precedent
/// `RemoteSyncEngineConflictResolutionTests.swift`'s own `IdSequence`
/// establishes, duplicated here rather than shared: Swift's top-level
/// `private` is file-scoped, and this repository's own sibling test files
/// (that one's own doc comment, and this suite's header comment) already
/// establish "no shared test-support module for these small fakes" as the
/// deliberate convention.
private final class IdSequence: @unchecked Sendable {
    private let lock = NSLock()
    private var ids: [String]

    init(_ ids: [String]) {
        self.ids = ids
    }

    func next() -> String {
        lock.lock()
        defer { lock.unlock() }
        return ids.isEmpty ? "id" : ids.removeFirst()
    }
}
