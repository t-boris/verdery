import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// Covers `RemoteSyncEngine.pullChanges()`: multi-page application with
/// cursor advancement, the cursor_expired-then-resync-once-then-fail path,
/// and dispatch to a `SyncPullRecordApplier`. Push-side coverage stays in
/// `RemoteSyncEngineTests.swift` — split out for this codebase's own
/// file-size discipline (`node scripts/check-file-size.mjs`'s 600-line
/// ceiling), matching how `MapEditorViewModelSaveStatusTests.swift` already
/// splits out of `MapEditorViewModelTests.swift`.
@Suite("Remote sync engine — pull")
struct RemoteSyncEnginePullTests {
    private func makeEngine(
        gateway: FakePullSyncGateway,
        cursorStore: any SyncCursorStore = InMemorySyncCursorStore(),
        applier: any SyncRecordApplier,
        pullPageLimit: Int = 2,
        maxPullPagesPerCall: Int = 20
    ) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: InMemorySyncOutboxStore(),
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: cursorStore,
            appliers: [applier],
            appVersion: "1.0.0",
            pullPageLimit: pullPageLimit,
            maxPullPagesPerCall: maxPullPagesPerCall,
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )
    }

    private func change(
        sequence: Int64,
        recordId: String,
        operation: SyncChangeOperation = .upsert,
        gardenId: String? = "garden-1"
    ) -> SyncChange {
        SyncChange(
            sequence: sequence,
            gardenId: gardenId,
            recordId: recordId,
            recordType: "garden",
            operation: operation,
            recordRevision: 1,
            committedAt: Date(timeIntervalSince1970: 0),
            snapshot: operation == .upsert ? .garden(garden(id: recordId)) : nil
        )
    }

    private func garden(id: String) -> Garden {
        Garden(
            id: id, name: "Garden \(id)", lifecycleState: .active, callerRole: .owner,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("pullChanges applies every page's items and advances the cursor after each, stopping once a page is short")
    func appliesMultiplePagesAndAdvancesCursor() async throws {
        let cursorStore = InMemorySyncCursorStore()
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        // `pullPageLimit: 2` below — a full page (2 items) means "more to
        // fetch"; this page's own single item makes it short, the stopping
        // signal.
        await gateway.enqueue(.success(SyncChangesPage(
            items: [change(sequence: 1, recordId: "garden-a"), change(sequence: 2, recordId: "garden-b")],
            nextCursor: "cursor-1"
        )))
        await gateway.enqueue(.success(SyncChangesPage(items: [change(sequence: 3, recordId: "garden-c")], nextCursor: "cursor-2")))
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 2)

        try await engine.pullChanges()

        let upsertedIds = await applier.upsertedRecordIds
        #expect(upsertedIds == ["garden-a", "garden-b", "garden-c"])
        #expect(try await cursorStore.current()?.cursor == "cursor-2")
        let requestedAfters = await gateway.requestedAfters
        // First call omits `after` (fresh cursor store); second call resumes
        // from the first page's own `nextCursor` — proving the cursor
        // genuinely advanced between pages, not just at the very end.
        #expect(requestedAfters == [nil, "cursor-1"])
        #expect(await engine.status == .synchronized)
    }

    @Test("pullChanges stops at maxPullPagesPerCall without losing progress already made")
    func stopsAtPageSafetyLimit() async throws {
        let cursorStore = InMemorySyncCursorStore()
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        for index in 0..<5 {
            await gateway.enqueue(.success(SyncChangesPage(
                items: [change(sequence: Int64(index), recordId: "garden-\(index)"), change(sequence: Int64(index), recordId: "garden-\(index)-b")],
                nextCursor: "cursor-\(index)"
            )))
        }
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 2, maxPullPagesPerCall: 3)

        try await engine.pullChanges()

        // Every page returned exactly `pullPageLimit` items, so the engine
        // never sees the "caught up" signal — it stops purely because of
        // the safety limit, having durably advanced through the third page.
        #expect(try await cursorStore.current()?.cursor == "cursor-2")
        let callCount = await gateway.callCount
        #expect(callCount == 3)
    }

    @Test("A cursor_expired 409 triggers exactly one resync retry with after omitted, then succeeds")
    func cursorExpiredRetriesOnceThenSucceeds() async throws {
        let cursorStore = InMemorySyncCursorStore()
        try await cursorStore.advance(cursor: "stale-cursor", at: Date(timeIntervalSince1970: 0))
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        await gateway.enqueue(.failure(.service(
            APIErrorBody(code: SyncErrorCode.cursorExpired.rawValue, message: "Too old.", correlationId: "c-1", details: nil, retryable: false),
            statusCode: 409,
            retryAfterSeconds: nil
        )))
        await gateway.enqueue(.success(SyncChangesPage(items: [change(sequence: 1, recordId: "garden-a")], nextCursor: "cursor-fresh")))
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 100)

        try await engine.pullChanges()

        let requestedAfters = await gateway.requestedAfters
        // First attempt uses the stale cursor; the 409 clears it, and the
        // retry omits `after` entirely — a genuine full resync, not a retry
        // of the same request.
        #expect(requestedAfters == ["stale-cursor", nil])
        #expect(try await cursorStore.current()?.cursor == "cursor-fresh")
        #expect(await engine.status == .synchronized)
    }

    @Test("A second consecutive cursor_expired 409 is not retried again — it surfaces as a real failure")
    func secondConsecutiveCursorExpiredSurfacesAsFailure() async throws {
        let cursorStore = InMemorySyncCursorStore()
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        let failure = APIGatewayError.service(
            APIErrorBody(code: SyncErrorCode.cursorExpired.rawValue, message: "Too old.", correlationId: "c-1", details: nil, retryable: false),
            statusCode: 409,
            retryAfterSeconds: nil
        )
        await gateway.enqueue(.failure(failure))
        await gateway.enqueue(.failure(failure))
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 100)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pullChanges()
        }

        let callCount = await gateway.callCount
        // Exactly two attempts: the original plus the one full-resync retry
        // — never a third.
        #expect(callCount == 2)
        #expect(await engine.status == .requiresAttention)
        #expect(await applier.upsertedRecordIds.isEmpty)
    }

    @Test("A protocol_version_unsupported 409 is treated as full-resync-required the same as cursor_expired")
    func protocolVersionUnsupportedTriggersResync() async throws {
        let cursorStore = InMemorySyncCursorStore()
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        await gateway.enqueue(.failure(.service(
            APIErrorBody(code: SyncErrorCode.protocolVersionUnsupported.rawValue, message: "Upgrade required.", correlationId: "c-1", details: nil, retryable: false),
            statusCode: 409,
            retryAfterSeconds: nil
        )))
        await gateway.enqueue(.success(SyncChangesPage(items: [], nextCursor: "cursor-fresh")))
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 100)

        try await engine.pullChanges()

        #expect(try await cursorStore.current()?.cursor == "cursor-fresh")
    }

    @Test("A delete change dispatches to applyDelete, not applyUpsert")
    func deleteChangeDispatchesToApplyDelete() async throws {
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        await gateway.enqueue(.success(SyncChangesPage(
            items: [change(sequence: 1, recordId: "garden-a", operation: .delete)],
            nextCursor: "cursor-1"
        )))
        let engine = makeEngine(gateway: gateway, applier: applier, pullPageLimit: 100)

        try await engine.pullChanges()

        #expect(await applier.upsertedRecordIds.isEmpty)
        #expect(await applier.deletedRecordIds == ["garden-a"])
    }

    @Test("A record type with no pull-capable applier registered is skipped without failing")
    func unregisteredPullRecordTypeIsSkipped() async throws {
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        let unprojected = SyncChange(
            sequence: 1, gardenId: "garden-1", recordId: "calib-1", recordType: "calibration",
            operation: .upsert, recordRevision: 1, committedAt: Date(timeIntervalSince1970: 0),
            snapshot: .unprojected(recordType: "calibration")
        )
        await gateway.enqueue(.success(SyncChangesPage(items: [unprojected], nextCursor: "cursor-1")))
        let engine = makeEngine(gateway: gateway, applier: applier, pullPageLimit: 100)

        try await engine.pullChanges()

        #expect(await applier.upsertedRecordIds.isEmpty)
    }

    /// P5-SEC-01's own garden-partition cascade: a `garden`/`delete` change
    /// must reach EVERY registered applier's `removeGardenScopedData(
    /// gardenId:)` — not just the one applier whose `recordType` matches
    /// `"garden"` — and must clear this garden's still-pending outbox rows
    /// and stale operation-result rows while leaving a different garden's
    /// own rows, and every conflict record, untouched.
    @Test("A garden/delete change cascades removeGardenScopedData to every registered applier and sweeps only that garden's outbox/operation-result rows, preserving conflicts")
    func gardenDeleteCascadesToEveryRegisteredApplier() async throws {
        let gardenApplier = FakePullApplier(recordType: "garden")
        let plantApplier = FakePullApplier(recordType: "plant")
        let outboxStore = InMemorySyncOutboxStore()
        let conflictStore = InMemorySyncConflictStore()
        let operationResultStore = InMemorySyncOperationResultStore()
        try await outboxStore.enqueue(OutboxOperation(
            id: "op-revoked-garden", profileId: "profile-1", gardenId: "garden-1", commandType: "plants.addPlant",
            commandVersion: 1, targetRecordIds: ["plant-1"], expectedRevision: nil,
            payload: #"{"recordType":"plant"}"#, createdAt: Date(timeIntervalSince1970: 0)
        ))
        try await outboxStore.enqueue(OutboxOperation(
            id: "op-other-garden", profileId: "profile-1", gardenId: "garden-2", commandType: "plants.addPlant",
            commandVersion: 1, targetRecordIds: ["plant-2"], expectedRevision: nil,
            payload: #"{"recordType":"plant"}"#, createdAt: Date(timeIntervalSince1970: 0)
        ))
        try await conflictStore.record(SyncConflict(
            id: "conflict-1", originalOperationId: "op-x", gardenId: "garden-1", recordType: "garden",
            conflictCode: "staleRevision", localRepresentation: "{}", serverRepresentation: "{}",
            suggestedRecoveryActions: [.keepServerVersion], createdAt: Date(timeIntervalSince1970: 0)
        ))
        try await operationResultStore.record(SyncOperationResult(
            operationId: "op-x", gardenId: "garden-1", outcome: .rejected, receivedAt: Date(timeIntervalSince1970: 0)
        ))
        try await operationResultStore.record(SyncOperationResult(
            operationId: "op-y", gardenId: "garden-2", outcome: .rejected, receivedAt: Date(timeIntervalSince1970: 0)
        ))
        let gateway = FakePullSyncGateway()
        await gateway.enqueue(.success(SyncChangesPage(
            items: [change(sequence: 1, recordId: "garden-1", operation: .delete)],
            nextCursor: "cursor-1"
        )))
        let engine = RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            operationResultStore: operationResultStore,
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [gardenApplier, plantApplier],
            appVersion: "1.0.0",
            pullPageLimit: 100,
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )

        try await engine.pullChanges()

        // Every registered applier — including one whose own `recordType`
        // ("plant") has nothing to do with the "garden" record type this
        // change names — is called.
        #expect(await gardenApplier.removedGardenIds == ["garden-1"])
        #expect(await plantApplier.removedGardenIds == ["garden-1"])

        // Only the revoked garden's outbox row is gone; the other garden's
        // is untouched.
        #expect(try await outboxStore.fetchPending(gardenId: "garden-1").isEmpty)
        #expect(try await outboxStore.fetchAll().map(\.id) == ["op-other-garden"])

        // Only the revoked garden's stale operation-result row is gone.
        #expect(try await operationResultStore.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await operationResultStore.fetchAll(gardenId: "garden-2").map(\.operationId) == ["op-y"])

        // The conflict record survives — architecture/offline-
        // synchronization.md, section "11. Authorization Changes": "after
        // preserving only policy-approved conflict or export recovery
        // information."
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").map(\.id) == ["conflict-1"])
    }

    @Test("An ordinary (non-garden) delete change does not trigger the garden-partition cascade")
    func nonGardenDeleteDoesNotCascade() async throws {
        let gardenApplier = FakePullApplier(recordType: "garden")
        let plantApplier = FakePullApplier(recordType: "plant")
        let gateway = FakePullSyncGateway()
        let plantDelete = SyncChange(
            sequence: 1, gardenId: "garden-1", recordId: "plant-1", recordType: "plant",
            operation: .delete, recordRevision: 2, committedAt: Date(timeIntervalSince1970: 0), snapshot: nil
        )
        await gateway.enqueue(.success(SyncChangesPage(items: [plantDelete], nextCursor: "cursor-1")))
        let engine = RemoteSyncEngine(
            outboxStore: InMemorySyncOutboxStore(),
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [gardenApplier, plantApplier],
            appVersion: "1.0.0",
            pullPageLimit: 100,
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )

        try await engine.pullChanges()

        #expect(await gardenApplier.removedGardenIds.isEmpty)
        #expect(await plantApplier.removedGardenIds.isEmpty)
        #expect(await plantApplier.deletedRecordIds == ["plant-1"])
    }

    @Test("A genuine transport failure sets waitingForConnectivity and does not advance the cursor")
    func transportFailureSetsWaitingForConnectivity() async throws {
        let cursorStore = InMemorySyncCursorStore()
        let applier = FakePullApplier(recordType: "garden")
        let gateway = FakePullSyncGateway()
        await gateway.enqueue(.failure(.transport(code: .notConnectedToInternet, correlationId: "c-1")))
        let engine = makeEngine(gateway: gateway, cursorStore: cursorStore, applier: applier, pullPageLimit: 100)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pullChanges()
        }

        #expect(try await cursorStore.current() == nil)
        #expect(await engine.status == .waitingForConnectivity)
    }
}

/// Records every `applyUpsert`/`applyDelete` call — a `SyncRecordApplier`
/// AND `SyncPullRecordApplier` conformer local to this file, mirroring
/// `RemoteSyncEngineTests.FakeSyncRecordApplier`'s identical role for push.
private actor FakePullApplier: SyncRecordApplier, SyncPullRecordApplier {
    nonisolated let recordType: String
    private(set) var upsertedRecordIds: [String] = []
    private(set) var deletedRecordIds: [String] = []
    private(set) var removedGardenIds: [String] = []

    init(recordType: String) {
        self.recordType = recordType
    }

    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}

    func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .garden(garden) = snapshot else { return }
        upsertedRecordIds.append(garden.id)
    }

    func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {
        deletedRecordIds.append(recordId)
    }

    func removeGardenScopedData(gardenId: String) async throws {
        removedGardenIds.append(gardenId)
    }
}

/// Fake `SyncGateway` for pull tests — an actor, matching
/// `RemoteSyncEngineTests.FakeSyncGateway`'s identical "real async engine
/// calls need real actor isolation" reasoning. Only `getChanges` is
/// meaningfully stubbed; the other four methods are unused by pull tests.
private actor FakePullSyncGateway: SyncGateway {
    enum Answer {
        case success(SyncChangesPage)
        case failure(APIGatewayError)
    }

    private var queue: [Answer] = []
    private(set) var requestedAfters: [String?] = []
    private(set) var callCount = 0

    func enqueue(_ answer: Answer) {
        queue.append(answer)
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] { [] }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        requestedAfters.append(after)
        callCount += 1
        guard !queue.isEmpty else {
            return SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
        }
        switch queue.removeFirst() {
        case let .success(page): return page
        case let .failure(error): throw error
        }
    }
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    let id: String

    func currentOrGenerated() async throws -> String { id }
}
