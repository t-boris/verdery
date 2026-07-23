import CoreDomain
import CoreNetworking
import CoreObservability
import CorePersistence
import Foundation

/// The real, network-backed `SyncEngine`: drains `sync_outbox`, pushes one
/// bounded batch through `CoreNetworking.SyncGateway`, pulls the profile-wide
/// change log, and applies each result back to its owning feature's local
/// store via the registered `SyncRecordApplier` — or, for outcomes that need
/// no feature involvement, directly through `CorePersistence`'s own durable
/// stores. See `SyncRecordApplier`'s own doc comment for exactly which of
/// the six push outcomes route where, and why; see `RemoteSyncEngine+Pull
/// .swift` for the pull side (P5-IOS-03, Stage 5b).
///
/// This type does not replace `LocalOnlySyncEngine`; both stay available
/// products, the same way `InMemoryGardenStore` stays alongside
/// `GRDBGardenStore` as a test double — `LocalOnlySyncEngine` still has
/// genuine value for a preview or a test that wants `CorePersistence`'s
/// local storage exercised with no network dependency at all.
///
/// One bounded batch per call, not a loop that drains the whole outbox: the
/// contract bounds one push request to `SyncPushRequest.operations.maxItems`
/// (500) operations, and repeatedly draining a large backlog with retry and
/// backoff between attempts is exactly what a caller repeatedly invoking
/// `pushPending()` (a trigger, see `RemoteSyncEngine+Pull.swift`'s
/// `retryNow()`) already accomplishes across calls, without this method
/// looping unboundedly within one.
///
/// Source: architecture/offline-synchronization.md, sections "7. Outbox
/// Operation" through "10. Pull Protocol", "12. Initial Synchronization",
/// "15. Local Conflict Recovery", "20. Connectivity and Backoff";
/// architecture/ios-application-design.md, section "8. Synchronization
/// Integration"; implementation-plan.md work package P5-IOS-03.
public actor RemoteSyncEngine: SyncEngine {
    /// `packages/api-contracts/openapi.yaml`, `SyncPushRequest.operations.maxItems`.
    static let maxBatchSize = 500

    let outboxStore: any SyncOutboxStore
    let conflictStore: any SyncConflictStore
    let operationResultStore: any SyncOperationResultStore
    let gateway: any SyncGateway
    let clientInstallationStore: any ClientInstallationIdentityStore
    /// Consulted by `RemoteSyncEngine+Pull.swift`; see
    /// `CorePersistence.SyncCursorStore`'s own doc comment for why this is a
    /// single profile-scoped cursor, not one per garden.
    let cursorStore: any SyncCursorStore
    let appliersByRecordType: [String: any SyncRecordApplier]
    let appVersion: String
    let protocolVersion: Int
    let operationPayloadVersion: Int
    /// One page of `GET /sync/changes` per `RemoteSyncEngine+Pull.swift`
    /// `pullChanges()` call requests at most this many items — defaults to
    /// `packages/api-contracts/openapi.yaml`, `components.parameters.Limit`'s
    /// own `maximum: 100`, which minimizes round trips for a large backlog.
    /// Overridable only for tests, so a multi-page pull scenario needs only
    /// a handful of fake items per page, not hundreds, to exercise the
    /// "page returned fewer than the limit — caught up" stopping condition.
    let pullPageLimit: Int
    /// A bounded safety limit on pages fetched per `pullChanges()` call, not
    /// a claim that the default (20) is always enough to catch up: the same
    /// "one bounded unit of work per call, a caller invokes it again for
    /// more" shape `maxBatchSize`'s own one-batch-per-`pushPending()`-call
    /// contract already establishes for push, applied to pull. 20 pages at
    /// the default `pullPageLimit` (100) items each bounds one call to at
    /// most 2,000 applied items — enough to make real, visible progress
    /// against a large backlog within one foreground/trigger cycle (this
    /// stage's own testing concern, "Large backlog with bounded memory" —
    /// architecture/offline-synchronization.md, section "24. Testing
    /// Matrix"), while guaranteeing `pullChanges()` always returns control
    /// to its caller in bounded time even against a pathological backlog,
    /// rather than looping unboundedly until caught up. Overridable only for
    /// tests, for the same reason `pullPageLimit` is.
    let maxPullPagesPerCall: Int
    let now: @Sendable () -> Date
    let generateConflictId: @Sendable () -> String
    /// Generates a fresh id for a conflict-resolution outbox operation
    /// (`reapplyLocalIntent`/`duplicateAsNewObject`) and, for
    /// `duplicateAsNewObject`, the brand-new record id it creates —
    /// `CoreSynchronization.RemoteSyncEngine+ConflictResolution.swift`'s own
    /// concern, injected here for the same determinism-in-tests reason
    /// `generateConflictId` already is. A separate closure from
    /// `generateConflictId`, not a reuse of it: the two id spaces are
    /// different (`SyncConflict.id` versus `OutboxOperation.id`/a new
    /// record's own id), and a test exercising both wants to tell them apart.
    let generateOperationId: @Sendable () -> String
    /// Injected jitter source for `SyncBackoff` — the same `now` injection
    /// pattern, applied to `Double.random(in:)`, for deterministic backoff
    /// tests (this stage's own testing requirement: "deterministic, not
    /// flaky").
    let randomUnitInterval: @Sendable () -> Double
    /// Privacy-safe local diagnostics — the same `DiagnosticLog` protocol
    /// every `CoreNetworking` gateway already takes, applied here for the one
    /// sync metric only the device can observe: outbox backlog age (see
    /// `logOutboxBacklogAge()`'s own doc comment for why this is a local log
    /// record rather than a Crashlytics/Firebase Performance event). Defaults
    /// to `NoOperationDiagnosticLog()`, the same default every gateway
    /// initializer uses, so existing call sites need no change.
    let log: any DiagnosticLog

    /// Registration is a one-time-per-process step, not per push cycle: the
    /// endpoint is a "register or refresh" idempotent `PUT`
    /// (architecture/offline-synchronization.md, section
    /// "12. Initial Synchronization", step 1), but re-sending it on every
    /// `pushPending()` call would cost one avoidable round trip per cycle
    /// for no benefit once this process already knows it registered.
    var hasRegisteredClient = false

    /// Read-only observable summary of this engine instance's own most
    /// recent activity — see `SyncEngineStatus`'s own doc comment for what
    /// this does and does not cover, and for why per-feature UI is not wired
    /// to it in this stage.
    public internal(set) var status: SyncEngineStatus = .unknown

    /// The most recent transient push failure this engine instance has seen
    /// — an in-memory, per-instance gate on top of `SyncOutboxStore
    /// .recordAttempt`'s durable per-operation bookkeeping (see
    /// `pushPending()`'s own doc comment for why both exist). `nil` once a
    /// push cycle completes with nothing transiently failed.
    var pushFailureGate: TransientFailureGate?
    /// The identical gate for pull, keyed by nothing (pull carries no
    /// operation id at all — see `CoreDomain.SyncCursor`'s own doc comment
    /// for why pull is profile-scoped, not per-operation or per-garden).
    var pullFailureGate: TransientFailureGate?

    /// One classified transient failure's own retry bookkeeping — deliberately
    /// NOT `CoreDomain.RetryState` reused as-is: that type persists to
    /// `sync_outbox` and is keyed to one specific operation id;
    /// `pullFailureGate` has no operation id to key by at all (pull is
    /// profile-scoped), and `pushFailureGate` intentionally stays
    /// in-memory/per-instance — see `pushPending()`'s own doc comment for
    /// why a coarser, whole-call gate is this stage's deliberate scope,
    /// distinct from (and layered on top of) the durable per-operation
    /// attempt count `SyncOutboxStore.recordAttempt` still records.
    struct TransientFailureGate: Sendable {
        let attemptCount: Int
        let lastAttemptedAt: Date
        let retryAfterSeconds: Int?
    }

    public init(
        outboxStore: any SyncOutboxStore,
        conflictStore: any SyncConflictStore,
        operationResultStore: any SyncOperationResultStore,
        gateway: any SyncGateway,
        clientInstallationStore: any ClientInstallationIdentityStore,
        cursorStore: any SyncCursorStore,
        appliers: [any SyncRecordApplier],
        appVersion: String,
        protocolVersion: Int = 1,
        operationPayloadVersion: Int = 1,
        pullPageLimit: Int = 100,
        maxPullPagesPerCall: Int = 20,
        now: @escaping @Sendable () -> Date = Date.init,
        generateConflictId: @escaping @Sendable () -> String = UUIDv7.generate,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate,
        randomUnitInterval: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.outboxStore = outboxStore
        self.conflictStore = conflictStore
        self.operationResultStore = operationResultStore
        self.gateway = gateway
        self.clientInstallationStore = clientInstallationStore
        self.cursorStore = cursorStore
        self.appliersByRecordType = Dictionary(uniqueKeysWithValues: appliers.map { ($0.recordType, $0) })
        self.appVersion = appVersion
        self.protocolVersion = protocolVersion
        self.operationPayloadVersion = operationPayloadVersion
        self.pullPageLimit = pullPageLimit
        self.maxPullPagesPerCall = maxPullPagesPerCall
        self.now = now
        self.generateConflictId = generateConflictId
        self.generateOperationId = generateOperationId
        self.randomUnitInterval = randomUnitInterval
        self.log = log
    }

    /// Submits every eligible pending outbox operation in one bounded batch.
    ///
    /// "Eligible" excludes an operation whose most recent attempt classified
    /// as a transient failure (`blockedByDependency`/`retryLater` from the
    /// server, or a genuine transport/gateway failure) until `SyncBackoff`
    /// says it is due — architecture/offline-synchronization.md, section
    /// "20. Connectivity and Backoff": "Authentication, authorization,
    /// validation, and conflict failures do not retry automatically as
    /// transient failures", implying transient ones (this method's own
    /// concern) DO retry automatically, but not immediately/unboundedly.
    /// An operation that has never been attempted (`retryState.attemptCount
    /// == 0`) — including one still carrying an open conflict, which this
    /// method never marks as attempted (see `apply(_:to:)`'s `.conflict`
    /// branch) — is always immediately eligible, unchanged from Stage 5a's
    /// behavior.
    ///
    /// Uses `SyncOutboxStore.recordAttempt` (built in Stage 3, never called
    /// before this stage) for durable, per-operation, cross-relaunch
    /// bookkeeping of *why* an operation last failed. `pushFailureGate`
    /// layers a coarser, in-memory, per-engine-instance gate on top,
    /// covering the case `recordAttempt` alone cannot: a genuine transport
    /// failure that prevents the whole push call from returning any
    /// per-operation outcome at all, so no single operation's own
    /// `retryState` can express "the whole batch just failed together."
    public func pushPending() async throws {
        try await ensureClientRegistered()
        try await logOutboxBacklogAge()

        guard SyncBackoff.isEligible(
            attemptCount: pushFailureGate?.attemptCount ?? 0,
            lastAttemptedAt: pushFailureGate?.lastAttemptedAt,
            retryAfter: pushFailureGate?.retryAfterSeconds.map(TimeInterval.init),
            now: now(),
            randomUnitInterval: randomUnitInterval
        ) else {
            return
        }

        let pending = try await eligiblePending()
        guard !pending.isEmpty else {
            try await refreshIdleStatus()
            return
        }

        status = .synchronizing
        let batch = Array(pending.prefix(Self.maxBatchSize))
        let clientInstallationId = try await clientInstallationStore.currentOrGenerated()

        let outcomes: [SyncPushOperationOutcome]
        do {
            outcomes = try await gateway.push(
                clientInstallationId: clientInstallationId,
                protocolVersion: protocolVersion,
                operationPayloadVersion: operationPayloadVersion,
                operations: batch
            )
        } catch let error as APIGatewayError {
            try await recordTransientFailure(error, for: batch)
            status = error.syncErrorCategory == .connectivity ? .waitingForConnectivity : .requiresAttention
            throw error
        }

        let outcomesByOperationId = Dictionary(uniqueKeysWithValues: outcomes.map { ($0.operationId, $0) })
        var sawTransientOutcome = false
        var transientRetryAfterSeconds: Int?

        for operation in batch {
            // An operation the response is silent about (should not happen —
            // the contract promises "one result per submitted operation" —
            // but a missing entry is safer read as "unresolved this round"
            // than as any specific outcome) is left exactly as it was, for
            // the next `pushPending()` call to retry.
            guard let outcome = outcomesByOperationId[operation.id] else { continue }
            if case let .retryLater(_, retryAfterSeconds, _) = outcome {
                sawTransientOutcome = true
                transientRetryAfterSeconds = max(transientRetryAfterSeconds ?? 0, retryAfterSeconds ?? 0)
            }
            if case .blockedByDependency = outcome { sawTransientOutcome = true }
            try await apply(outcome, to: operation)
        }

        if sawTransientOutcome {
            let batchIds = Set(batch.map(\.id))
            let attemptCount = try await outboxStore.fetchAll()
                .filter { batchIds.contains($0.id) }
                .map(\.retryState.attemptCount)
                .max() ?? 1
            pushFailureGate = TransientFailureGate(
                attemptCount: attemptCount,
                lastAttemptedAt: now(),
                retryAfterSeconds: transientRetryAfterSeconds
            )
            status = .savedLocally
        } else {
            pushFailureGate = nil
            try await refreshIdleStatus()
        }
    }

    /// Logs the oldest pending outbox operation's age, once per
    /// `pushPending()` call — architecture/observability-and-analytics.md,
    /// section "7. Service Metrics" → "Synchronization": "Outbox backlog age
    /// on devices through privacy-safe summaries." This is the one sync
    /// metric only the device can observe directly: a pending operation, by
    /// definition, has not reached the server yet, so no server-side log can
    /// ever carry it.
    ///
    /// Recorded through `CoreObservability.DiagnosticLog` (the local
    /// unified-logging record every `CoreNetworking` gateway already uses),
    /// not a Crashlytics/Firebase Performance event: confirmed by inspection
    /// of `Package.swift` that this codebase has neither dependency wired
    /// today — only `FirebaseAuth`/`FirebaseAppCheck`/`FirebaseCore` are
    /// declared — and architecture/observability-and-analytics.md section 8's
    /// own Crashlytics destination is accordingly out of proportion to add
    /// for one metric (a new third-party SDK dependency needs its own ADR
    /// under this repository's dependency rule, not a side effect of an
    /// observability work package). The count and duration logged here are
    /// exactly the kind of "privacy-safe summary" section 7 asks for — never
    /// the operation's `commandType`, `payload`, or `targetRecordIds`.
    private func logOutboxBacklogAge() async throws {
        let pending = try await outboxStore.fetchAll()
        guard let oldestCreatedAt = pending.map(\.createdAt).min() else {
            log.record(.info, "Sync outbox backlog: empty.", correlationId: nil)
            return
        }

        let ageSeconds = Int(now().timeIntervalSince(oldestCreatedAt).rounded())
        log.record(
            .info,
            "Sync outbox backlog: \(pending.count) pending, oldest age \(ageSeconds)s.",
            correlationId: nil
        )
    }

    /// Every pending operation whose backoff window (if any) has elapsed —
    /// `SyncBackoff.isEligible`, evaluated per operation against its own
    /// durable `retryState`.
    private func eligiblePending() async throws -> [OutboxOperation] {
        try await outboxStore.fetchAll().filter { operation in
            SyncBackoff.isEligible(
                attemptCount: operation.retryState.attemptCount,
                lastAttemptedAt: operation.retryState.lastAttemptedAt,
                now: now(),
                randomUnitInterval: randomUnitInterval
            )
        }
    }

    /// Records a durable attempt against every operation in `batch` — used
    /// only for a genuine gateway-layer failure (transport, or a `.service`
    /// error), never for a per-item server outcome, which already has its
    /// own outcome-specific handling in `apply(_:to:)`.
    private func recordTransientFailure(_ error: APIGatewayError, for batch: [OutboxOperation]) async throws {
        let category = error.syncErrorCategory
        let attemptedAt = now()
        for operation in batch {
            try await outboxStore.recordAttempt(operationId: operation.id, errorCategory: category, at: attemptedAt)
        }
        let attemptCount = (batch.map(\.retryState.attemptCount).max() ?? 0) + 1
        pushFailureGate = TransientFailureGate(
            attemptCount: attemptCount,
            lastAttemptedAt: attemptedAt,
            retryAfterSeconds: error.retryAfterSeconds
        )
    }

    func ensureClientRegistered() async throws {
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
            // P5-CONFLICT-01: this operation is itself a conflict's
            // resolution (`reapplyLocalIntent`/`duplicateAsNewObject`,
            // `RemoteSyncEngine+ConflictResolution.swift`) once its push is
            // finally confirmed — closing the conflict only now, not when
            // the resolution operation was first enqueued, is exactly
            // section "15. Local Conflict Recovery"'s "closes the prior
            // conflict only after the resolution is accepted". Generic: this
            // check is the ONLY thing that connects a confirmed push to a
            // conflict closing — no record-type-specific knowledge involved,
            // matching `SyncRecordApplier`'s own "engine stays generic"
            // convention.
            if let resolvesConflictId = operation.resolvesConflictId {
                try await conflictStore.remove(conflictId: resolvesConflictId)
            }

        case let .conflict(_, conflictCode, currentRecordType, currentRecordJSON):
            let conflict = SyncConflict(
                id: generateConflictId(),
                originalOperationId: operation.id,
                gardenId: operation.gardenId,
                recordType: currentRecordType,
                conflictCode: conflictCode,
                localRepresentation: operation.payload,
                serverRepresentation: currentRecordJSON,
                suggestedRecoveryActions: ConflictRecoveryPolicy.suggestedRecoveryActions(
                    forRecordType: currentRecordType,
                    commandType: operation.commandType
                ),
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
            // clears this one. Deliberately NOT passed through
            // `outboxStore.recordAttempt`: section "20. Connectivity and
            // Backoff" — "conflict failures do not retry automatically as
            // transient failures" — this row stays immediately eligible for
            // `pushPending()`'s own backoff filter (`attemptCount == 0`)
            // rather than being throttled like a genuine transient failure,
            // unchanged from Stage 5a's behavior.

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

        case .blockedByDependency, .retryLater:
            // No local storage change beyond durable retry bookkeeping — the
            // outbox row stays untouched for a future push attempt. Records
            // the category the same way for both: from this operation's own
            // point of view, "blocked on another operation" and "the server
            // asked me to wait" are both "the server itself reported a
            // transient condition," `SyncErrorCategory.server`'s own best
            // fit among the categories that exist (Stage 5b; Stage 5a left
            // this uncalled — see `pushPending()`'s own doc comment).
            // `pushPending()` itself derives the whole-call `pushFailureGate`
            // (including any `retryLater.retryAfterSeconds`) from the
            // outcomes it already has in hand, rather than this method
            // mutating shared gate state per-operation mid-loop.
            try await outboxStore.recordAttempt(operationId: operation.id, errorCategory: .server, at: now())

        case .unknown:
            // `acknowledge`-only outcome; `push` never returns it — see
            // `SyncPushOperationOutcome.unknown`'s own doc comment. No local
            // storage change of any kind.
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

    /// Recomputes `status` from durable state alone (no failure this cycle):
    /// `.synchronized` once the outbox is empty, `.savedLocally` while
    /// anything is still queued.
    func refreshIdleStatus() async throws {
        status = try await outboxStore.fetchAll().isEmpty ? .synchronized : .savedLocally
    }
}
