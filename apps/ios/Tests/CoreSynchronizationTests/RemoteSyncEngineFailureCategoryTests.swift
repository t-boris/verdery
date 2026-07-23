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
/// **A finding, not silently absorbed into this test's own expectations**:
/// `RemoteSyncEngine.pushPending()`'s whole-batch failure path
/// (`recordTransientFailure(_:for:)`) records `error.syncErrorCategory`
/// verbatim against every operation in the batch and sets `pushFailureGate`
/// unconditionally, for ANY `APIGatewayError` — not only `.server`/
/// `.connectivity`. `eligiblePending()`'s own per-operation filter then
/// applies `SyncBackoff` purely by `attemptCount`/`lastAttemptedAt`, with no
/// check on `lastErrorCategory` at all. Net effect: an authentication
/// failure on the WHOLE push call currently IS retried automatically once
/// the backoff window elapses, the same as a genuine transient server
/// failure — apparently in tension with section 20's stated rule, which this
/// engine's own per-OPERATION `blockedByDependency`/`retryLater` handling
/// (hardcoded to `.server` — see `apply(_:to:)`) correctly honors, but this
/// whole-batch path does not. This file deliberately does NOT assert that
/// automatic-retry behavior one way or the other (asserting it happens would
/// pin a questionable behavior as "correct"; asserting it does not would
/// fail against the code as it stands) — flagged in this stage's own report
/// as a candidate defect for explicit review, per this repository's "never
/// change behavior without approval" rule, rather than fixed here. What this
/// file DOES pin, correctly and unambiguously per the architecture document,
/// is the STATUS distinction below.
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
}

private actor FakeFailureGateway: SyncGateway {
    private var pushError: (@Sendable () -> APIGatewayError)?

    func setPushError(_ error: @escaping @Sendable () -> APIGatewayError) {
        pushError = error
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        if let pushError {
            throw pushError()
        }
        return []
    }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage {
        SyncChangesPage(items: [], nextCursor: after ?? "cursor-0")
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
