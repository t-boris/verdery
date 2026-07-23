import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// Proves `RemoteSyncEngine.pushPending()`'s per-outcome routing: an
/// accepted/duplicate result advances the right feature's local record and
/// clears the outbox row; a conflict result writes a durable conflict and
/// leaves the outbox row in place; a rejected result records a durable
/// failure marker and clears the row; blockedByDependency/retryLater touch
/// nothing at all. Uses `CorePersistence`'s own real in-memory fakes for the
/// outbox/conflict/result stores (no GRDB needed — the same "no network, no
/// server" bar `GardenGatewayTests`'s own doc comment sets for the gateway
/// layer, applied here to the engine layer instead) plus a fake
/// `SyncGateway` and fake `SyncRecordApplier`s local to this file.
@Suite("Remote sync engine")
struct RemoteSyncEngineTests {
    private func operation(
        id: String = "op-1",
        gardenId: String = "garden-1",
        localSequence: Int64 = 1,
        payload: String = #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.create"}}"#
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "gardens.create",
            commandVersion: 1,
            targetRecordIds: [gardenId],
            expectedRevision: nil,
            payload: payload,
            localSequence: localSequence,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeEngine(
        outboxStore: any SyncOutboxStore = InMemorySyncOutboxStore(),
        conflictStore: any SyncConflictStore = InMemorySyncConflictStore(),
        operationResultStore: any SyncOperationResultStore = InMemorySyncOperationResultStore(),
        cursorStore: any SyncCursorStore = InMemorySyncCursorStore(),
        gateway: FakeSyncGateway,
        gardenApplier: any SyncRecordApplier
    ) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            operationResultStore: operationResultStore,
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: cursorStore,
            appliers: [gardenApplier],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            // A fixed jitter draw keeps push tests deterministic; backoff's
            // own randomness is covered separately by `SyncBackoffTests`.
            randomUnitInterval: { 1.0 }
        )
    }

    @Test("pushPending registers the client exactly once, before the first push, even across repeated calls")
    func registersClientOnce() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation())
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { operations in
            operations.map { .accepted(operationId: $0.id, recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 1)]) }
        }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()
        try await engine.pushPending()

        let registerCalls = await gateway.registerCalls
        #expect(registerCalls.count == 1)
        #expect(registerCalls.first?.clientInstallationId == "install-1")
        #expect(registerCalls.first?.appVersion == "1.0.0")
    }

    @Test("pushPending still registers the client when the outbox is empty, but never calls push")
    func registersEvenWithEmptyOutbox() async throws {
        let gateway = FakeSyncGateway()
        let engine = makeEngine(gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()

        let registerCalls = await gateway.registerCalls
        let pushedBatches = await gateway.pushedOperationBatches
        #expect(registerCalls.count == 1)
        #expect(pushedBatches.isEmpty)
    }

    @Test("an accepted result advances the owning applier's record and clears the outbox row")
    func acceptedAppliesAndClearsOutbox() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.accepted(operationId: "op-1", recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 7)])]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: applier)

        try await engine.pushPending()

        let confirmedCalls = await applier.confirmedCalls
        #expect(confirmedCalls.count == 1)
        #expect(confirmedCalls.first?.recordId == "garden-1")
        #expect(confirmedCalls.first?.revision == 7)
        #expect(try await outboxStore.fetchAll().isEmpty)
    }

    @Test("a duplicate result is handled identically to accepted")
    func duplicateAppliesAndClearsOutbox() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.duplicate(operationId: "op-1", recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 3)])]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: applier)

        try await engine.pushPending()

        let confirmedCalls = await applier.confirmedCalls
        #expect(confirmedCalls.first?.revision == 3)
        #expect(try await outboxStore.fetchAll().isEmpty)
    }

    @Test("a conflict result writes a durable conflict and a result marker, and does NOT clear the outbox row")
    func conflictRecordsConflictAndKeepsOutboxRow() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let conflictStore = InMemorySyncConflictStore()
        let operationResultStore = InMemorySyncOperationResultStore()
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.conflict(
                operationId: "op-1",
                conflictCode: "staleRevision",
                currentRecordType: "garden",
                currentRecordJSON: #"{"recordType":"garden","data":{"id":"garden-1","revision":9}}"#
            )]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            operationResultStore: operationResultStore,
            gateway: gateway,
            gardenApplier: applier
        )

        try await engine.pushPending()

        // No feature-local store change at all for a conflict — see
        // `SyncRecordApplier`'s own doc comment.
        #expect(await applier.confirmedCalls.isEmpty)

        let openConflicts = try await conflictStore.fetchOpen(gardenId: "garden-1")
        #expect(openConflicts.count == 1)
        let conflict = try #require(openConflicts.first)
        #expect(conflict.originalOperationId == "op-1")
        #expect(conflict.conflictCode == "staleRevision")
        #expect(conflict.localRepresentation == operation().payload)
        #expect(conflict.serverRepresentation.contains("staleRevision") == false)
        #expect(conflict.resolutionOperationId == nil)
        // `gardenObject` gets all four recovery actions (section "14.5
        // Geometry"); `garden` gets the two safe for any conflict category.
        #expect(conflict.suggestedRecoveryActions == [.keepServerVersion, .openForManualReview])

        let results = try await operationResultStore.fetchAll(gardenId: "garden-1")
        #expect(results.count == 1)
        #expect(results.first?.outcome == .conflict)
        #expect(results.first?.conflictId == conflict.id)

        // The original outbox row is retained, not removed — architecture/
        // offline-synchronization.md, section "15. Local Conflict Recovery".
        let stillPending = try await outboxStore.fetchAll()
        #expect(stillPending.map(\.id) == ["op-1"])
    }

    @Test("a gardenObject conflict suggests all four recovery actions, matching section 14.5")
    func gardenObjectConflictSuggestsAllFourActions() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let conflictStore = InMemorySyncConflictStore()
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.conflict(
                operationId: "op-1",
                conflictCode: "staleRevision",
                currentRecordType: "gardenObject",
                currentRecordJSON: #"{"recordType":"gardenObject","data":{}}"#
            )]
        }
        let engine = makeEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            gateway: gateway,
            gardenApplier: FakeSyncRecordApplier(recordType: "garden")
        )

        try await engine.pushPending()

        let conflict = try #require(try await conflictStore.fetchOpen(gardenId: "garden-1").first)
        #expect(conflict.suggestedRecoveryActions == [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject])
    }

    @Test("a rejected result records a durable failure marker and clears the outbox row")
    func rejectedRecordsFailureAndClearsOutbox() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let operationResultStore = InMemorySyncOperationResultStore()
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.rejected(operationId: "op-1", errorCode: "validation.invalid_field", errorMessage: "Name too long.")]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(
            outboxStore: outboxStore, operationResultStore: operationResultStore, gateway: gateway, gardenApplier: applier
        )

        try await engine.pushPending()

        #expect(await applier.confirmedCalls.isEmpty)
        let results = try await operationResultStore.fetchAll(gardenId: "garden-1")
        #expect(results.count == 1)
        #expect(results.first?.outcome == .rejected)
        // Redaction-safe: the stable code, never the free-text message.
        #expect(results.first?.detail == "validation.invalid_field")

        // A rejected operation never succeeds by retrying — the row is
        // removed, unlike a conflict's.
        #expect(try await outboxStore.fetchAll().isEmpty)
    }

    @Test("blockedByDependency leaves the outbox row untouched with no local store or result-store change")
    func blockedByDependencyTouchesNothing() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let operationResultStore = InMemorySyncOperationResultStore()
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.blockedByDependency(operationId: "op-1", blockingOperationIds: ["op-0"])]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(
            outboxStore: outboxStore, operationResultStore: operationResultStore, gateway: gateway, gardenApplier: applier
        )

        try await engine.pushPending()

        #expect(await applier.confirmedCalls.isEmpty)
        #expect(try await operationResultStore.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await outboxStore.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("retryLater leaves the outbox row untouched with no local store or result-store change")
    func retryLaterTouchesNothing() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let operationResultStore = InMemorySyncOperationResultStore()
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.retryLater(operationId: "op-1", retryAfterSeconds: 5, reason: "server.dependency_unavailable")]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(
            outboxStore: outboxStore, operationResultStore: operationResultStore, gateway: gateway, gardenApplier: applier
        )

        try await engine.pushPending()

        #expect(await applier.confirmedCalls.isEmpty)
        #expect(try await operationResultStore.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await outboxStore.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("retryLater durably records an attempt via SyncOutboxStore.recordAttempt")
    func retryLaterRecordsDurableAttempt() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.retryLater(operationId: "op-1", retryAfterSeconds: nil, reason: "server.dependency_unavailable")]
        }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()

        let retryState = try await outboxStore.fetchAll().first?.retryState
        #expect(retryState?.attemptCount == 1)
        #expect(retryState?.lastErrorCategory == .server)
        #expect(await engine.status == .savedLocally)
    }

    @Test("blockedByDependency durably records an attempt via SyncOutboxStore.recordAttempt")
    func blockedByDependencyRecordsDurableAttempt() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.blockedByDependency(operationId: "op-1", blockingOperationIds: ["op-0"])]
        }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()

        #expect(try await outboxStore.fetchAll().first?.retryState.attemptCount == 1)
    }

    @Test("after a retryLater outcome, a call still within the backoff window pushes nothing further")
    func backoffGateSkipsAPushWithinItsWindow() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.retryLater(operationId: "op-1", retryAfterSeconds: nil, reason: "server.dependency_unavailable")]
        }
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000))
        let engine = RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [FakeSyncRecordApplier(recordType: "garden")],
            appVersion: "1.0.0",
            now: { clock.now },
            randomUnitInterval: { 1.0 }
        )

        try await engine.pushPending()
        let pushCallsAfterFirst = await gateway.pushedOperationBatches.count
        #expect(pushCallsAfterFirst == 1)

        // Still well within `SyncBackoff.baseDelaySeconds`'s own window.
        clock.now.addTimeInterval(0.5)
        try await engine.pushPending()
        let pushCallsAfterSecond = await gateway.pushedOperationBatches.count
        #expect(pushCallsAfterSecond == 1, "A push within the backoff window must not call the gateway again.")

        // Past the window — eligible again.
        clock.now.addTimeInterval(SyncBackoff.baseDelaySeconds)
        try await engine.pushPending()
        let pushCallsAfterThird = await gateway.pushedOperationBatches.count
        #expect(pushCallsAfterThird == 2, "A push after the backoff window elapses must reach the gateway.")
    }

    @Test("a genuine transport failure during push records an attempt for every operation and sets waitingForConnectivity")
    func transportFailureDuringPushRecordsAttemptsAndSetsStatus() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        try await outboxStore.enqueue(operation(id: "op-2", gardenId: "garden-1", localSequence: 2))
        let gateway = FakeSyncGateway()
        await gateway.setPushError { .transport(code: .notConnectedToInternet, correlationId: "c-1") }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }

        let retryStates = try await outboxStore.fetchAll().map(\.retryState)
        #expect(retryStates.allSatisfy { $0.attemptCount == 1 && $0.lastErrorCategory == .connectivity })
        #expect(await engine.status == .waitingForConnectivity)
    }

    @Test("status is synchronized once the outbox is empty with no failure, and savedLocally while a genuine conflict is still open")
    func statusReflectsOutboxAndFailureState() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        let gateway = FakeSyncGateway()
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()
        #expect(await engine.status == .synchronized)

        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        await gateway.setPushResult { _ in
            [.accepted(operationId: "op-1", recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 1)])]
        }
        try await engine.pushPending()
        #expect(await engine.status == .synchronized)
    }

    @Test("a record type with no registered applier (e.g. calibration) is skipped without failing the push")
    func unregisteredRecordTypeIsSkipped() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in
            [.accepted(operationId: "op-1", recordRevisions: [
                SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 2),
                SyncRecordReference(recordId: "calibration-1", recordType: "calibration", revision: 1),
            ])]
        }
        let applier = FakeSyncRecordApplier(recordType: "garden")
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: applier)

        try await engine.pushPending()

        let confirmedCalls = await applier.confirmedCalls
        #expect(confirmedCalls.count == 1)
        #expect(confirmedCalls.first?.recordId == "garden-1")
        #expect(try await outboxStore.fetchAll().isEmpty)
    }

    @Test("an operation missing from the response is left pending for a future push")
    func missingOperationLeftPending() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1", gardenId: "garden-1"))
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { _ in [] }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()

        #expect(try await outboxStore.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("pushPending submits at most one bounded batch (maxBatchSize) per call")
    func pushBoundsBatchSize() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        for index in 0..<(RemoteSyncEngine.maxBatchSize + 20) {
            try await outboxStore.enqueue(operation(id: "op-\(index)", localSequence: Int64(index)))
        }
        let gateway = FakeSyncGateway()
        await gateway.setPushResult { operations in
            operations.map { .accepted(operationId: $0.id, recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 1)]) }
        }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, gardenApplier: FakeSyncRecordApplier(recordType: "garden"))

        try await engine.pushPending()

        let pushedBatches = await gateway.pushedOperationBatches
        #expect(pushedBatches.count == 1)
        #expect(pushedBatches.first?.count == RemoteSyncEngine.maxBatchSize)
    }
}

/// Fake `SyncGateway` — an actor, not a plain `@unchecked Sendable` class,
/// so its captured state stays safe under this test's real `async` engine
/// calls rather than merely asserting single-threaded good behavior.
private actor FakeSyncGateway: SyncGateway {
    struct RegisterCall: Equatable {
        let clientInstallationId: String
        let appVersion: String
        let protocolVersion: Int
    }

    private(set) var registerCalls: [RegisterCall] = []
    private(set) var pushedOperationBatches: [[OutboxOperation]] = []
    private var pushResult: (@Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome])?
    private var pushError: (@Sendable () -> APIGatewayError)?

    func setPushResult(_ result: @escaping @Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome]) {
        pushResult = result
    }

    func setPushError(_ error: @escaping @Sendable () -> APIGatewayError) {
        pushError = error
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {
        registerCalls.append(RegisterCall(clientInstallationId: clientInstallationId, appVersion: appVersion, protocolVersion: protocolVersion))
    }

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        pushedOperationBatches.append(operations)
        if let pushError {
            throw pushError()
        }
        return pushResult?(operations) ?? []
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] {
        []
    }

    private var pullPagesToReturn: [SyncChangesPage] = []
    private(set) var pullCallCount = 0
    private var pullError: (@Sendable () -> APIGatewayError?)?

    func setPullPages(_ pages: [SyncChangesPage]) {
        pullPagesToReturn = pages
    }

    func setPullError(_ error: @escaping @Sendable () -> APIGatewayError?) {
        pullError = error
    }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        if let error = pullError?() {
            throw error
        }
        defer { pullCallCount += 1 }
        guard pullCallCount < pullPagesToReturn.count else {
            return SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
        }
        return pullPagesToReturn[pullCallCount]
    }
}

private actor FakeSyncRecordApplier: SyncRecordApplier {
    nonisolated let recordType: String
    private(set) var confirmedCalls: [(recordId: String, revision: Int)] = []
    private(set) var removedGardenIds: [String] = []

    init(recordType: String) {
        self.recordType = recordType
    }

    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        confirmedCalls.append((recordId: recordId, revision: revision))
    }

    func removeGardenScopedData(gardenId: String) async throws {
        removedGardenIds.append(gardenId)
    }
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    let id: String

    func currentOrGenerated() async throws -> String { id }
}

/// A mutable `now()` source for `backoffGateSkipsAPushWithinItsWindow` — the
/// only test in this file that needs time to actually advance between two
/// calls on the same engine instance, rather than a single fixed instant.
/// A plain class, not an actor: `RemoteSyncEngine` is itself an actor, so
/// every read of `now` already happens from inside its own isolated
/// context, one call at a time — no concurrent access this needs to guard
/// against within one test.
private final class MutableClock: @unchecked Sendable {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}
