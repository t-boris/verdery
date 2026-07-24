import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation
import Testing

@testable import CoreSynchronization

/// "Authentication expiration" (architecture/offline-synchronization.md,
/// section "24. Testing Matrix") for the sync-specific behavior of a token
/// expiring mid-push — distinct from Phase 2/3's own general token-
/// verification coverage, which this file does not duplicate. The concern
/// here is narrow and specific: does `RemoteSyncEngine.pushPending()`
/// surface a whole-batch `401 auth.unauthenticated` failure distinctly from
/// an ordinary connectivity failure, per section "20. Connectivity and
/// Backoff" — "Authentication, authorization, validation, and conflict
/// failures do not retry automatically as transient failures" — which this
/// engine's own `status` model expresses as `.requiresAttention` (a signal
/// this repository's `FeatureSyncConflicts`/settings surfaces distinctly
/// from "the network is down"), not `.waitingForConnectivity`.
///
/// A separate file from `RemoteSyncEngineTests.swift` (already close to this
/// repository's 600-line limit) — the same split-by-concern precedent
/// `RemoteSyncEngineOutboxBacklogTests.swift`/`RemoteSyncEngineBacklogDrainTests
/// .swift` already establish.
///
/// **A finding from P5-QA-01, and this follow-up's own fix.** Before this
/// stage, `RemoteSyncEngine.pushPending()`'s whole-batch failure path
/// (`recordTransientFailure(_:for:)`) recorded `error.syncErrorCategory`
/// verbatim against every operation in the batch and set `pushFailureGate`
/// unconditionally, for ANY `APIGatewayError` — not only `.server`/
/// `.connectivity`. `eligiblePending()`'s own per-operation filter then
/// applied `SyncBackoff` purely by `attemptCount`/`lastAttemptedAt`, with no
/// check on `lastErrorCategory` at all. Net effect: an authentication
/// failure on the WHOLE push call was retried automatically once the
/// backoff window elapsed, the same as a genuine transient server failure —
/// in tension with section 20's stated rule, which this engine's own
/// per-OPERATION `blockedByDependency`/`retryLater` handling (hardcoded to
/// `.server` — see `apply(_:to:)`) already correctly honored, but this
/// whole-batch path did not.
///
/// **The fix** (`eligiblePending(bypassingAutomaticRetryGate:)`,
/// `SyncErrorCategory.isEligibleForAutomaticRetry`): an operation whose most
/// recently recorded failure category is authentication, authorization,
/// validation, or conflict is now excluded from an AUTOMATIC
/// `pushPending()` call's batch regardless of elapsed backoff time — it
/// stays excluded until either a later attempt records a different category,
/// or the caller uses `retryNow()`'s own explicit-retry override, which
/// deliberately still attempts any category (architecture/offline-
/// synchronization.md, section 20's own closing bullet: "User-initiated
/// retry can wake eligible work"). `refreshIdleStatus()` also now
/// distinguishes this durably-blocked state from ordinary `.savedLocally`: a
/// pending operation permanently excluded this way contributes
/// `.requiresAttention` instead. `automaticRetryDoesNotResubmitAnAuthBlocked
/// OperationOnceBackoffElapses`/`explicitRetryNowStillAttemptsAnAuthBlocked
/// Operation` below are the tests that would have failed against the
/// pre-fix code and now pass. What this file already pinned, correctly and
/// unambiguously per the architecture document before this fix too, is the
/// STATUS distinction right below.
@Suite("Remote sync engine — failure category (authentication expiration)")
struct RemoteSyncEngineFailureCategoryTests {
    private func operation(id: String = "op-1") -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "gardens.rename",
            commandVersion: 1,
            targetRecordIds: ["garden-1"],
            expectedRevision: 3,
            payload: #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.rename"}}"#,
            localSequence: 1,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeEngine(outboxStore: any SyncOutboxStore, gateway: FakeFailureGateway) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [FakeFailureApplier(recordType: "garden")],
            appVersion: "1.0.0",
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )
    }

    /// A mutable-`now()` variant for the two tests below that need real
    /// elapsed time between two calls on the same engine instance — the same
    /// `MutableClock` pattern `RemoteSyncEngineTests
    /// .backoffGateSkipsAPushWithinItsWindow` already establishes.
    private func makeEngine(outboxStore: any SyncOutboxStore, gateway: FakeFailureGateway, clock: MutableClock) -> RemoteSyncEngine {
        RemoteSyncEngine(
            outboxStore: outboxStore,
            conflictStore: InMemorySyncConflictStore(),
            operationResultStore: InMemorySyncOperationResultStore(),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: InMemorySyncCursorStore(),
            appliers: [FakeFailureApplier(recordType: "garden")],
            appVersion: "1.0.0",
            now: { clock.now },
            randomUnitInterval: { 1.0 }
        )
    }

    private func unauthenticatedFailure() -> APIGatewayError {
        .service(
            APIErrorBody(
                code: SharedErrorCode.unauthenticated.rawValue,
                message: "The ID token has expired.",
                correlationId: "c-auth-1",
                details: nil,
                retryable: false
            ),
            statusCode: 401,
            retryAfterSeconds: nil
        )
    }

    @Test("A 401 auth.unauthenticated failure mid-push sets requiresAttention, distinctly from a connectivity failure")
    func authenticationExpirationSetsRequiresAttention() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation())
        let gateway = FakeFailureGateway()
        await gateway.setPushError { self.unauthenticatedFailure() }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }

        #expect(await engine.status == .requiresAttention)
    }

    @Test("A genuine transport failure mid-push sets waitingForConnectivity, not requiresAttention — the two categories stay distinguishable")
    func connectivityFailureSetsWaitingForConnectivityNotRequiresAttention() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation())
        let gateway = FakeFailureGateway()
        await gateway.setPushError { .transport(code: .notConnectedToInternet, correlationId: "c-net-1") }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }

        #expect(await engine.status == .waitingForConnectivity)
    }

    @Test("A 401 auth.unauthenticated failure durably records the authentication category against every operation in the failed batch")
    func authenticationFailureRecordsAuthenticationCategory() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1"))
        let gateway = FakeFailureGateway()
        await gateway.setPushError { self.unauthenticatedFailure() }
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }

        let retryState = try await outboxStore.fetchAll().first?.retryState
        #expect(retryState?.attemptCount == 1)
        #expect(retryState?.lastErrorCategory == .authentication)
    }

    @Test("Automatic pushPending() does not resubmit an operation blocked by an auth-categorized whole-call failure, even once the backoff window elapses — this test failed against the pre-fix code")
    func automaticRetryDoesNotResubmitAnAuthBlockedOperationOnceBackoffElapses() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1"))
        let gateway = FakeFailureGateway()
        await gateway.setPushError { self.unauthenticatedFailure() }
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000))
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, clock: clock)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }
        #expect(await gateway.pushCallCount == 1)

        // Comfortably past even a large exponential backoff window — the old
        // code retried automatically here because `eligiblePending()` never
        // consulted `lastErrorCategory` at all, only elapsed time.
        clock.now.addTimeInterval(SyncBackoff.maxDelaySeconds * 2)
        try await engine.pushPending()

        #expect(await gateway.pushCallCount == 1, "an auth-categorized whole-call failure must not be retried automatically")
        // The operation is still durably pending (never removed) and now
        // permanently excluded from automatic batches — `refreshIdleStatus()`
        // must surface that as `.requiresAttention`, not `.savedLocally`
        // (which would misleadingly read as "just waiting its turn").
        #expect(try await outboxStore.fetchAll().map(\.id) == ["op-1"])
        #expect(await engine.status == .requiresAttention)
    }

    @Test("retryNow() still attempts an operation blocked by an auth-categorized whole-call failure — explicit retry bypasses the automatic-retry category gate")
    func explicitRetryNowStillAttemptsAnAuthBlockedOperation() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1"))
        let gateway = FakeFailureGateway()
        await gateway.setPushError { self.unauthenticatedFailure() }
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000))
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, clock: clock)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }
        #expect(await gateway.pushCallCount == 1)

        clock.now.addTimeInterval(SyncBackoff.maxDelaySeconds * 2)
        // The token has since been refreshed — the second attempt succeeds.
        await gateway.setPushError(nil)
        await gateway.setPushResult { operations in
            operations.map { .accepted(operationId: $0.id, recordRevisions: []) }
        }

        try await engine.retryNow()

        #expect(await gateway.pushCallCount == 2, "an explicit retryNow() must still attempt an auth-blocked operation")
        #expect(try await outboxStore.fetchAll().isEmpty)
    }

    @Test("Automatic pushPending() DOES resubmit an operation blocked by a genuine transport (connectivity) whole-call failure once the backoff window elapses — the fix is category-specific, not a blanket ban on automatic retry after any whole-call failure")
    func automaticRetryStillResubmitsAConnectivityBlockedOperationOnceBackoffElapses() async throws {
        let outboxStore = InMemorySyncOutboxStore()
        try await outboxStore.enqueue(operation(id: "op-1"))
        let gateway = FakeFailureGateway()
        await gateway.setPushError { .transport(code: .notConnectedToInternet, correlationId: "c-net-1") }
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000))
        let engine = makeEngine(outboxStore: outboxStore, gateway: gateway, clock: clock)

        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }
        #expect(await gateway.pushCallCount == 1)

        clock.now.addTimeInterval(SyncBackoff.maxDelaySeconds * 2)
        await #expect(throws: APIGatewayError.self) {
            try await engine.pushPending()
        }

        #expect(await gateway.pushCallCount == 2, "a genuine transient (connectivity) whole-call failure must still retry automatically once backoff elapses")
    }
}

private actor FakeFailureGateway: SyncGateway {
    private var pushError: (@Sendable () -> APIGatewayError)?
    private var pushResult: (@Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome])?
    private(set) var pushCallCount = 0

    func setPushError(_ error: (@Sendable () -> APIGatewayError)?) {
        pushError = error
    }

    func setPushResult(_ result: @escaping @Sendable ([OutboxOperation]) -> [SyncPushOperationOutcome]) {
        pushResult = result
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        pushCallCount += 1
        if let pushError {
            throw pushError()
        }
        return pushResult?(operations) ?? []
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
    }
}

/// A mutable `now()` source for tests that need real elapsed time between two
/// calls on the same engine instance — mirrors `RemoteSyncEngineTests`'s own
/// `MutableClock` (a plain class, not an actor: every read of `now` already
/// happens from inside `RemoteSyncEngine`'s own actor isolation, one call at
/// a time, so there is no concurrent access within one test to guard
/// against).
private final class MutableClock: @unchecked Sendable {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}

private actor FakeFailureApplier: SyncRecordApplier {
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
