import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation

/// The real, network-backed `SyncEngine`: drains `sync_outbox`, pushes one
/// bounded batch through `CoreNetworking.SyncGateway`, and applies each
/// result back to its owning feature's local store via the registered
/// `SyncRecordApplier` — or, for outcomes that need no feature involvement,
/// directly through `CorePersistence`'s own durable stores. See
/// `SyncRecordApplier`'s own doc comment for exactly which of the six push
/// outcomes route where, and why.
///
/// `pullChanges()` stays the same genuine no-op `LocalOnlySyncEngine`
/// implements — Stage 5b's job (architecture/offline-synchronization.md,
/// section "10. Pull Protocol"). This type does not replace
/// `LocalOnlySyncEngine`; both stay available products, the same way
/// `InMemoryGardenStore` stays alongside `GRDBGardenStore` as a test double
/// — `LocalOnlySyncEngine` still has genuine value for a preview or a test
/// that wants `CorePersistence`'s local storage exercised with no network
/// dependency at all.
///
/// One bounded batch per call, not a loop that drains the whole outbox: the
/// contract bounds one push request to `SyncPushRequest.operations.maxItems`
/// (500) operations, and repeatedly draining a large backlog with retry and
/// backoff between attempts is exactly Stage 5b's "bounded push/pull engine,
/// backoff, checkpointing" scope — this stage builds the one bounded push
/// operation that a future scheduler calls repeatedly, not the calling loop
/// itself.
///
/// Source: architecture/offline-synchronization.md, sections "7. Outbox
/// Operation" through "9. Server Idempotency", "12. Initial Synchronization",
/// "15. Local Conflict Recovery"; architecture/ios-application-design.md,
/// section "8. Synchronization Integration"; implementation-plan.md work
/// package P5-IOS-03, Stage 5a.
public actor RemoteSyncEngine: SyncEngine {
    /// `packages/api-contracts/openapi.yaml`, `SyncPushRequest.operations.maxItems`.
    static let maxBatchSize = 500

    private let outboxStore: any SyncOutboxStore
    private let conflictStore: any SyncConflictStore
    private let operationResultStore: any SyncOperationResultStore
    private let gateway: any SyncGateway
    private let clientInstallationStore: any ClientInstallationIdentityStore
    private let appliersByRecordType: [String: any SyncRecordApplier]
    private let appVersion: String
    private let protocolVersion: Int
    private let operationPayloadVersion: Int
    private let now: @Sendable () -> Date
    private let generateConflictId: @Sendable () -> String

    /// Registration is a one-time-per-process step, not per push cycle: the
    /// endpoint is a "register or refresh" idempotent `PUT`
    /// (architecture/offline-synchronization.md, section
    /// "12. Initial Synchronization", step 1), but re-sending it on every
    /// `pushPending()` call would cost one avoidable round trip per cycle
    /// for no benefit once this process already knows it registered.
    private var hasRegisteredClient = false

    public init(
        outboxStore: any SyncOutboxStore,
        conflictStore: any SyncConflictStore,
        operationResultStore: any SyncOperationResultStore,
        gateway: any SyncGateway,
        clientInstallationStore: any ClientInstallationIdentityStore,
        appliers: [any SyncRecordApplier],
        appVersion: String,
        protocolVersion: Int = 1,
        operationPayloadVersion: Int = 1,
        now: @escaping @Sendable () -> Date = Date.init,
        generateConflictId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.outboxStore = outboxStore
        self.conflictStore = conflictStore
        self.operationResultStore = operationResultStore
        self.gateway = gateway
        self.clientInstallationStore = clientInstallationStore
        self.appliersByRecordType = Dictionary(uniqueKeysWithValues: appliers.map { ($0.recordType, $0) })
        self.appVersion = appVersion
        self.protocolVersion = protocolVersion
        self.operationPayloadVersion = operationPayloadVersion
        self.now = now
        self.generateConflictId = generateConflictId
    }

    public func pushPending() async throws {
        try await ensureClientRegistered()

        let pending = try await outboxStore.fetchAll()
        guard !pending.isEmpty else { return }

        let batch = Array(pending.prefix(Self.maxBatchSize))
        let clientInstallationId = try await clientInstallationStore.currentOrGenerated()

        let outcomes = try await gateway.push(
            clientInstallationId: clientInstallationId,
            protocolVersion: protocolVersion,
            operationPayloadVersion: operationPayloadVersion,
            operations: batch
        )
        let outcomesByOperationId = Dictionary(uniqueKeysWithValues: outcomes.map { ($0.operationId, $0) })

        for operation in batch {
            // An operation the response is silent about (should not happen —
            // the contract promises "one result per submitted operation" —
            // but a missing entry is safer read as "unresolved this round"
            // than as any specific outcome) is left exactly as it was, for
            // the next `pushPending()` call to retry.
            guard let outcome = outcomesByOperationId[operation.id] else { continue }
            try await apply(outcome, to: operation)
        }
    }

    public func pullChanges() async throws {
        // No pull protocol yet — Stage 5b builds this against
        // `CoreNetworking.SyncGateway`'s future `GET /sync/changes` call and
        // `CorePersistence.SyncCursorStore`.
    }

    private func ensureClientRegistered() async throws {
        guard !hasRegisteredClient else { return }

        let clientInstallationId = try await clientInstallationStore.currentOrGenerated()
        try await gateway.registerClient(
            clientInstallationId: clientInstallationId,
            appVersion: appVersion,
            protocolVersion: protocolVersion
        )
        hasRegisteredClient = true
    }

    private func apply(_ outcome: SyncPushOperationOutcome, to operation: OutboxOperation) async throws {
        switch outcome {
        case .accepted(_, let recordRevisions), .duplicate(_, let recordRevisions):
            try await applyConfirmedRecords(recordRevisions)
            // Accepted and duplicate are both terminal, successful outcomes
            // for this operation id (architecture/offline-synchronization.md,
            // section "9. Server Idempotency") — nothing more to retry.
            try await outboxStore.remove(operationId: operation.id)

        case let .conflict(_, conflictCode, currentRecordType, currentRecordJSON):
            let conflict = SyncConflict(
                id: generateConflictId(),
                originalOperationId: operation.id,
                gardenId: operation.gardenId,
                conflictCode: conflictCode,
                localRepresentation: operation.payload,
                serverRepresentation: currentRecordJSON,
                suggestedRecoveryActions: Self.suggestedRecoveryActions(forRecordType: currentRecordType),
                createdAt: now()
            )
            try await conflictStore.record(conflict)
            try await operationResultStore.record(
                SyncOperationResult(
                    operationId: operation.id,
                    gardenId: operation.gardenId,
                    outcome: .conflict,
                    conflictId: conflict.id,
                    detail: conflictCode,
                    receivedAt: now()
                )
            )
            // The outbox row is deliberately RETAINED, not removed:
            // architecture/offline-synchronization.md, section "15. Local
            // Conflict Recovery" — "Resolving a conflict creates a new
            // outbox command and closes the prior conflict only after the
            // resolution is accepted" — implies the original operation stays
            // associated with the conflict record until a resolution
            // supersedes it, not silently discarded the moment a conflict is
            // detected. P5-CONFLICT-01 (a later stage) builds the recovery
            // flow that eventually creates that resolution operation and
            // clears this one.

        case let .rejected(_, errorCode, _):
            try await operationResultStore.record(
                SyncOperationResult(
                    operationId: operation.id,
                    gardenId: operation.gardenId,
                    outcome: .rejected,
                    detail: errorCode,
                    receivedAt: now()
                )
            )
            // Unlike `conflict`, a rejected operation will never succeed by
            // retrying — section "9. Server Idempotency" ties one operation
            // id to one stable, permanent outcome, and `rejected` carries no
            // "resubmit to resolve" path the way a conflict's resolution
            // operation does. The row is removed, not held.
            try await outboxStore.remove(operationId: operation.id)

        case .blockedByDependency, .retryLater, .unknown:
            // No local storage change of any kind, and the outbox row stays
            // untouched for a future push attempt. Retry timing and backoff
            // bookkeeping (`OutboxOperation.retryState`, via
            // `SyncOutboxStore.recordAttempt`) are Stage 5b's concern, not
            // this stage's — see this type's own doc comment.
            break
        }
    }

    private func applyConfirmedRecords(_ recordRevisions: [SyncRecordReference]) async throws {
        let confirmedAt = now()
        for reference in recordRevisions {
            guard let applier = appliersByRecordType[reference.recordType] else {
                // A record type this client does not project locally at all
                // yet — `calibration`, a side effect of `map.upsertCalibration`
                // with no local read model of its own — see
                // `SyncRecordApplier`'s own doc comment. Not an error: a
                // future stage that adds a local calibration cache registers
                // an applier for it then.
                continue
            }
            try await applier.applyConfirmed(recordId: reference.recordId, revision: reference.revision, confirmedAt: confirmedAt)
        }
    }

    /// Suggested recovery actions per record type — generic policy
    /// `CoreSynchronization` decides entirely on its own from the wire's
    /// plain `SyncRecordType` string, with no feature-specific knowledge
    /// needed: neither `ConflictRecoveryAction` nor a record type name is
    /// feature-owned. `gardenObject` gets all four, matching
    /// architecture/offline-synchronization.md, section "14.5 Geometry"
    /// verbatim — the one place the architecture spells out a per-category
    /// list ("Keep the server version. Reapply the local intent... Open
    /// both versions for manual review. Duplicate as a new object..."").
    /// Every other record type gets the two actions safe for any conflict
    /// category: `reapplyLocalIntent` requires the operation be "safely
    /// replayable" (section 14.5's own qualifier), a judgment this stage has
    /// no contract-pinned vocabulary to make per record type yet
    /// (`SyncConflict.conflictCode` is still a plain `String` — see that
    /// type's own doc comment), and `duplicateAsNewObject` is a
    /// geometry-specific recovery with no obvious meaning for a garden,
    /// plant, task, or observation.
    private static func suggestedRecoveryActions(forRecordType recordType: String) -> [ConflictRecoveryAction] {
        switch recordType {
        case "gardenObject":
            [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        default:
            [.keepServerVersion, .openForManualReview]
        }
    }
}
