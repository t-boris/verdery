import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// Proves `RemoteSyncEngine.resolveConflict(_:action:)`'s four dispatch
/// branches (P5-CONFLICT-01) — using local fakes, not `RemoteSyncEngineTests`'
/// own file-private ones (Swift's top-level `private` is file-scoped).
@Suite("Remote sync engine conflict resolution")
struct RemoteSyncEngineConflictResolutionTests {
    private static let gardenServerJSON =
        #"{"recordType":"garden","data":{"id":"garden-1","name":"Server Garden","lifecycleState":"active","callerRole":"owner","revision":9,"createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z"}}"#

    private func originalOperation(
        id: String = "op-original",
        gardenId: String = "garden-1",
        commandType: String = "gardens.rename",
        targetRecordIds: [String] = ["garden-1"],
        payload: String = #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.rename","expectedRevision":3,"request":{"name":"Local Name"}}}"#
    ) -> OutboxOperation {
        OutboxOperation(
            id: id, profileId: "profile-1", gardenId: gardenId, commandType: commandType, commandVersion: 1,
            targetRecordIds: targetRecordIds, expectedRevision: 3, payload: payload, localSequence: 1,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func conflict(
        id: String = "conflict-1",
        originalOperationId: String = "op-original",
        gardenId: String = "garden-1",
        recordType: String = "garden",
        serverRepresentation: String = gardenServerJSON,
        suggestedRecoveryActions: [ConflictRecoveryAction] = [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
    ) -> SyncConflict {
        SyncConflict(
            id: id, originalOperationId: originalOperationId, gardenId: gardenId, recordType: recordType,
            conflictCode: "staleRevision", localRepresentation: "{}", serverRepresentation: serverRepresentation,
            suggestedRecoveryActions: suggestedRecoveryActions, createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeEngine(
        outboxStore: any SyncOutboxStore,
        conflictStore: any SyncConflictStore,
        appliers: [any SyncRecordApplier],
        gateway: any SyncGateway = InertGateway(),
        generateOperationId: @escaping @Sendable () -> String = { "generated-id" }
    ) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: conflictStore,
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(),
            cursorStore: InMemorySyncCursorStore(),
            appliers: appliers,
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: generateOperationId,
            randomUnitInterval: { 1.0 }
        )
    }

    // MARK: - keepServerVersion

    @Test("keepServerVersion removes the pending operation, overwrites the local record, and closes the conflict immediately")
    func keepServerVersionDiscardsLocalState() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation())
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict()
        try await conflictStore.record(theConflict)
        let applier = ReplayableApplier(recordType: "garden")
        let engine = makeEngine(outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier])

        try await engine.resolveConflict(theConflict, action: .keepServerVersion)

        #expect(try await outboxStore.fetch(operationId: "op-original") == nil)
        let upsertCalls = await applier.applyUpsertCalls
        #expect(upsertCalls.count == 1)
        if case let .garden(garden) = upsertCalls.first {
            #expect(garden.name == "Server Garden")
        } else {
            Issue.record("expected a decoded garden snapshot")
        }
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").isEmpty)
    }

    @Test("keepServerVersion for a record type with no local cache just discards the pending operation")
    func keepServerVersionWithNoLocalCache() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation(id: "op-observation", commandType: "observations.record"))
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict(
            originalOperationId: "op-observation", recordType: "observation",
            serverRepresentation: #"{"recordType":"observation","data":{}}"#,
            suggestedRecoveryActions: [.keepServerVersion, .openForManualReview]
        )
        try await conflictStore.record(theConflict)
        let applier = BasicApplier(recordType: "observation")
        let engine = makeEngine(outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier])

        try await engine.resolveConflict(theConflict, action: .keepServerVersion)

        #expect(try await outboxStore.fetch(operationId: "op-observation") == nil)
        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").isEmpty)
    }

    // MARK: - reapplyLocalIntent

    @Test("reapplyLocalIntent enqueues a correctly-shaped new operation and does not close the conflict until it is later confirmed")
    func reapplyTwoStepTiming() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation())
        let conflictStore = SpyConflictStore()
        let theConflict = conflict()
        try await conflictStore.record(theConflict)
        let applier = ReplayableApplier(recordType: "garden")
        let gateway = ScriptedGateway()
        let engine = makeEngine(
            outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier], gateway: gateway,
            generateOperationId: { "resolution-op-1" }
        )

        try await engine.resolveConflict(theConflict, action: .reapplyLocalIntent)

        // Step 1: the stale original is gone; a new, correctly-shaped
        // operation (server's revision, tagged to this conflict) replaces
        // it — but the conflict is only marked resolved, not yet removed.
        #expect(try await outboxStore.fetch(operationId: "op-original") == nil)
        let pending = try await outboxStore.fetchAll()
        #expect(pending.map(\.id) == ["resolution-op-1"])
        let resolutionOperation = try #require(pending.first)
        #expect(resolutionOperation.resolvesConflictId == "conflict-1")
        #expect(resolutionOperation.expectedRevision == 9)
        #expect(resolutionOperation.commandType == "gardens.rename")
        #expect(resolutionOperation.payload.contains(#""expectedRevision":9"#))
        let resolveCalls = await conflictStore.resolveCalls
        #expect(resolveCalls.map(\.conflictId) == ["conflict-1"])
        let removeCallsAfterStepOne = await conflictStore.removeCalls
        #expect(removeCallsAfterStepOne.isEmpty, "the conflict must not be removed before its resolution is confirmed")

        // Step 2: only once the resolution operation's own push is confirmed
        // does the conflict actually close.
        await gateway.setPushResult { operations in
            operations.map {
                .accepted(operationId: $0.id, recordRevisions: [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 9)])
            }
        }
        try await engine.pushPending()

        #expect(try await outboxStore.fetchAll().isEmpty)
        let removeCallsAfterStepTwo = await conflictStore.removeCalls
        #expect(removeCallsAfterStepTwo == ["conflict-1"])
    }

    @Test("reapplyLocalIntent throws when the record type's applier does not support replay")
    func reapplyUnsupportedRecordTypeThrows() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation(id: "op-observation", commandType: "observations.record"))
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict(originalOperationId: "op-observation", recordType: "observation")
        try await conflictStore.record(theConflict)
        let applier = BasicApplier(recordType: "observation")
        let engine = makeEngine(outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier])

        do {
            try await engine.resolveConflict(theConflict, action: .reapplyLocalIntent)
            Issue.record("expected actionNotSupportedForRecordType")
        } catch SyncConflictResolutionError.actionNotSupportedForRecordType {
            // expected
        }
    }

    @Test("resolveConflict throws when the original operation was already removed")
    func originalOperationMissingThrows() async throws {
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict()
        try await conflictStore.record(theConflict)
        let engine = makeEngine(
            outboxStore: InMemorySyncOutboxStore(), conflictStore: conflictStore, appliers: [ReplayableApplier(recordType: "garden")]
        )

        do {
            try await engine.resolveConflict(theConflict, action: .reapplyLocalIntent)
            Issue.record("expected originalOperationMissing")
        } catch SyncConflictResolutionError.originalOperationMissing {
            // expected
        }
    }

    // MARK: - duplicateAsNewObject

    @Test("duplicateAsNewObject enqueues a create-shaped operation for a new record and restores the server's version onto the original")
    func duplicateCreatesNewRecordAndKeepsServerOriginal() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation(commandType: "map.moveObject", targetRecordIds: ["object-1"]))
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict(
            recordType: "gardenObject",
            suggestedRecoveryActions: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        )
        try await conflictStore.record(theConflict)
        let duplicateDraft = ConflictResolutionOperationDraft(
            commandType: "map.createObject", commandVersion: 1, targetRecordIds: ["new-object-1"], expectedRevision: nil,
            payload: #"{"duplicated":true}"#
        )
        let generatedIds = IdSequence(["new-object-1", "resolution-op-1"])
        let applier = DuplicatingApplier(recordType: "gardenObject", duplicateResult: duplicateDraft)
        let engine = makeEngine(
            outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier],
            generateOperationId: { generatedIds.next() }
        )

        try await engine.resolveConflict(theConflict, action: .duplicateAsNewObject)

        // The original record is restored to the server's version, not superseded.
        #expect(try await outboxStore.fetch(operationId: "op-original") == nil)
        let upsertCalls = await applier.applyUpsertCalls
        #expect(upsertCalls.count == 1)

        // A genuinely new operation/record was enqueued alongside it.
        let pending = try await outboxStore.fetchAll()
        #expect(pending.map(\.id) == ["resolution-op-1"])
        #expect(pending.first?.targetRecordIds == ["new-object-1"])
        #expect(pending.first?.resolvesConflictId == "conflict-1")

        #expect(try await conflictStore.fetchOpen(gardenId: "garden-1").isEmpty)
    }

    @Test("duplicateAsNewObject throws when the applier judges the original unsuitable to duplicate")
    func duplicateNotAvailableThrows() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(originalOperation(commandType: "map.splitLinework", targetRecordIds: ["a", "b", "c"]))
        let conflictStore = InMemorySyncConflictStore()
        let theConflict = conflict(recordType: "gardenObject", suggestedRecoveryActions: [.keepServerVersion, .openForManualReview])
        try await conflictStore.record(theConflict)
        let applier = DuplicatingApplier(recordType: "gardenObject", duplicateResult: nil)
        let engine = makeEngine(outboxStore: outboxStore, conflictStore: conflictStore, appliers: [applier])

        do {
            try await engine.resolveConflict(theConflict, action: .duplicateAsNewObject)
            Issue.record("expected duplicateNotAvailable")
        } catch SyncConflictResolutionError.duplicateNotAvailable {
            // expected
        }
    }

    // MARK: - openForManualReview

    @Test("resolveConflict rejects openForManualReview — it is a UI presentation mode, not a resolution")
    func manualReviewThrows() async throws {
        let engine = makeEngine(outboxStore: InMemorySyncOutboxStore(), conflictStore: InMemorySyncConflictStore(), appliers: [])

        do {
            try await engine.resolveConflict(conflict(), action: .openForManualReview)
            Issue.record("expected manualReviewIsNotAResolution")
        } catch SyncConflictResolutionError.manualReviewIsNotAResolution {
            // expected
        }
    }
}

// MARK: - Fakes

private actor BasicApplier: SyncRecordApplier {
    nonisolated let recordType: String
    init(recordType: String) { self.recordType = recordType }
    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}
    func removeGardenScopedData(gardenId: String) async throws {}
}

private actor ReplayableApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictReplayableApplier {
    nonisolated let recordType: String
    private(set) var applyUpsertCalls: [SyncChangeSnapshot] = []

    init(recordType: String) { self.recordType = recordType }
    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}
    func removeGardenScopedData(gardenId: String) async throws {}
    func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {}

    func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        applyUpsertCalls.append(snapshot)
    }

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

private actor DuplicatingApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictDuplicatingApplier {
    nonisolated let recordType: String
    private(set) var applyUpsertCalls: [SyncChangeSnapshot] = []
    private let duplicateResult: ConflictResolutionOperationDraft?

    init(recordType: String, duplicateResult: ConflictResolutionOperationDraft?) {
        self.recordType = recordType
        self.duplicateResult = duplicateResult
    }

    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {}
    func removeGardenScopedData(gardenId: String) async throws {}
    func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {}

    func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        applyUpsertCalls.append(snapshot)
    }

    func duplicateDraft(original: OutboxOperation, newRecordId: String) async throws -> ConflictResolutionOperationDraft? {
        duplicateResult
    }
}

/// A `SyncConflictStore` spy — separate from `InMemorySyncConflictStore`
/// because proving the "resolve now, remove only later" two-step timing
/// requires distinguishing those two calls, which `fetchOpen(gardenId:)`
/// alone cannot (both make a conflict stop being "open").
private actor SpyConflictStore: SyncConflictStore {
    private var byId: [String: SyncConflict] = [:]
    private(set) var resolveCalls: [(conflictId: String, resolutionOperationId: String)] = []
    private(set) var removeCalls: [String] = []

    func record(_ conflict: SyncConflict) async throws {
        byId[conflict.id] = conflict
    }

    func fetchOpen(gardenId: String) async throws -> [SyncConflict] {
        byId.values.filter { $0.gardenId == gardenId && !$0.isResolved }.sorted { $0.createdAt < $1.createdAt }
    }

    func resolve(conflictId: String, resolutionOperationId: String, at date: Date) async throws {
        resolveCalls.append((conflictId, resolutionOperationId))
        if let existing = byId[conflictId] {
            byId[conflictId] = existing.resolving(withOperationId: resolutionOperationId, at: date)
        }
    }

    func remove(conflictId: String) async throws {
        removeCalls.append(conflictId)
        byId[conflictId] = nil
    }
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    func currentOrGenerated() async throws -> String { "install-1" }
}

/// A `SyncGateway` that never pushes/pulls anything unless scripted —
/// `resolveConflict(_:action:)` itself never calls the gateway at all, so
/// most tests in this file never need one beyond satisfying `RemoteSyncEngine
/// .init`'s required parameter.
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

/// `InertGateway` plus a settable push result, for the one test
/// (`reapplyTwoStepTiming`) that needs to script a later `pushPending()`
/// call confirming the resolution operation.
private actor ScriptedGateway: SyncGateway {
    private var pushResult: (@Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome])?

    func setPushResult(_ result: @escaping @Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome]) {
        pushResult = result
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String, protocolVersion: Int, operationPayloadVersion: Int, operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        pushResult?(operations) ?? []
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
    }
}

/// A small thread-safe queue of ids, for a test that needs `generateOperationId`
/// to return two distinct values across `resolveDuplicatingAsNewObject`'s two
/// calls to it (the new record's own id, then the new operation's own id).
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
