import CoreDomain
import CoreNetworking
import CoreObservability
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// Proves `RemoteSyncEngine.pushPending()` logs the outbox backlog age
/// (P5-OBS-01) — architecture/observability-and-analytics.md, section
/// "7. Service Metrics" → "Synchronization": "Outbox backlog age on devices
/// through privacy-safe summaries." This is the one sync metric only the
/// device can observe directly: a pending operation has, by definition,
/// never reached the server, so no server-side log can ever carry it. See
/// `RemoteSyncEngine.logOutboxBacklogAge()`'s own doc comment for why this is
/// a local `CoreObservability.DiagnosticLog` record rather than a
/// Crashlytics/Firebase Performance event — no such SDK is wired into this
/// codebase (confirmed by inspection of `Package.swift`), so adding one is
/// out of proportion for a single metric.
///
/// A separate file from `RemoteSyncEngineTests.swift` (not an addition to
/// it), matching this suite's own established split-by-concern precedent
/// (`RemoteSyncEnginePullTests.swift`, `RemoteSyncEngineConflictResolutionTests
/// .swift`) rather than pushing that file over the 600-line limit
/// `scripts/check-file-size.mjs` enforces. Fakes are local to this file,
/// following the same "no shared test-support module for these" convention
/// every sibling `RemoteSyncEngine*Tests.swift` file already uses for its own
/// `FakeClientInstallationIdentityStore`/`FakeSyncGateway`/
/// `FakeSyncRecordApplier`.
@Suite("Remote sync engine — outbox backlog age")
struct RemoteSyncEngineOutboxBacklogTests {
    private func operation(id: String, localSequence: Int64, createdAt: Date) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "gardens.create",
            commandVersion: 1,
            targetRecordIds: ["garden-1"],
            expectedRevision: nil,
            payload: #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.create"}}"#,
            localSequence: localSequence,
            createdAt: createdAt
        )
    }

    private func makeEngine(
        outboxStore: any SyncOutboxStore,
        gateway: FakeSyncGateway,
        log: any DiagnosticLog
    ) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [FakeSyncRecordApplier(recordType: "garden")],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            // A fixed jitter draw keeps this deterministic; backoff's own
            // randomness is covered separately by `SyncBackoffTests`.
            randomUnitInterval: { 1.0 },
            log: log
        )
    }

    @Test("pushPending logs an empty backlog when nothing is pending")
    func logsEmptyOutboxBacklog() async throws {
        let log = RecordingDiagnosticLog()
        let engine = makeEngine(outboxStore: InMemorySyncOutboxStore(), gateway: FakeSyncGateway(), log: log)

        try await engine.pushPending()

        #expect(log.records.contains { $0.message.contains("empty") })
    }

    @Test("pushPending logs the oldest pending operation's age, computed from its createdAt, before this call's own push can remove it")
    func logsOutboxBacklogAge() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        // `now` is fixed at `Date(timeIntervalSince1970: 1_000)` below — this
        // operation is 1000 seconds old at that instant, and the other is
        // newer, so the oldest-age figure must come from this one, not
        // whichever happens to be enqueued last.
        try await outboxStore.enqueue(operation(id: "op-1", localSequence: 1, createdAt: Date(timeIntervalSince1970: 0)))
        try await outboxStore.enqueue(operation(id: "op-2", localSequence: 2, createdAt: Date(timeIntervalSince1970: 400)))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { operations in
            operations.map { .accepted(operationId: $0.id, recordRevisions: []) }
        }
        let log = RecordingDiagnosticLog()
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, log: log)

        try await engine.pushPending()

        // Both operations are still pending at the moment this is computed:
        // the log call happens at the very start of `pushPending()`, ahead of
        // eligibility filtering, the push call, and outbox removal.
        #expect(log.records.contains { $0.message.contains("2 pending") && $0.message.contains("1000s") })
    }
}

/// A minimal fake `SyncGateway` — only `registerClient`/`push` are exercised
/// by this file's tests; `getChanges`/`acknowledge` are never called.
private actor FakeSyncGateway: SyncGateway {
    private(set) var registerCallCount = 0
    private var pushResult: (@Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome])?

    func setPushResult(_ result: @escaping @Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome]) {
        pushResult = result
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {
        registerCallCount += 1
    }

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        pushResult?(operations) ?? []
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] {
        []
    }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
    }
}

private actor FakeSyncRecordApplier: SyncRecordApplier {
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

/// Captures every `DiagnosticLog.record` call for assertion — a lock-based
/// `@unchecked Sendable` class, the same `IdSequence`-style precedent
/// `RemoteSyncEngineConflictResolutionTests.swift` uses for a synchronous
/// fake called from inside `RemoteSyncEngine`'s own actor isolation and read
/// back from the test's context afterward.
private final class RecordingDiagnosticLog: DiagnosticLog, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(level: DiagnosticLevel, message: String)] = []

    var records: [(level: DiagnosticLevel, message: String)] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func record(_ level: DiagnosticLevel, _ message: String, correlationId: CorrelationIdentifier?) {
        lock.lock()
        defer { lock.unlock() }
        recorded.append((level: level, message: message))
    }
}
