import CoreDomain
import CoreNetworking
import Foundation

/// The pull side of `RemoteSyncEngine` (P5-IOS-03, Stage 5b) —
/// `pullChanges()`, its page loop, and the "explicit user retry" trigger.
///
/// Pull is profile-scoped, not per-garden: see `CoreDomain.SyncCursor`'s own
/// doc comment for the full evidence this correction rests on. One durable
/// cursor (`CorePersistence.SyncCursorStore`), one `pullChanges()` call,
/// paged until caught up or a bounded safety limit.
///
/// **Checkpointing**: confirmed, not assumed, to already be inherent — the
/// same posture Stage 5a's own doc comment took for push's durability.
/// `applyPage(_:)` writes every item through a real `Local*Store` GRDB
/// transaction and then advances the cursor through
/// `SyncCursorStore.advance(cursor:at:)`'s own real GRDB transaction, in
/// that order, before this method ever starts the next page — so progress
/// genuinely survives a process death between pages.
///
/// **Not fully met, and explicitly not claimed**: architecture/offline-
/// synchronization.md, section "10. Pull Protocol"'s stronger claim, "The
/// client applies each page in one SQLite transaction and advances the
/// cursor only in that same transaction" — literally one shared transaction
/// spanning every applied item plus the cursor advance. Achieving that would
/// need every `SyncRecordApplier` to expose an "apply against an
/// already-open `Database` handle" variant the way
/// `CorePersistence.SyncOutboxTransactionWriter` does for the *push*/enqueue
/// side, which in turn would need `CoreSynchronization` (or the protocol
/// itself) to reach into GRDB — the exact boundary architecture/ios-
/// application-design.md, section "21. Dependency Rules" reserves to
/// `CorePersistence`/each feature's own adapter. This stage instead applies
/// each item through its existing, independently-transactional
/// `save`/`replaceAll`-style store method (the same one push's `confirmSynced`
/// already uses non-atomically alongside `SyncOutboxStore.remove`, a
/// precedent Stage 5a already shipped), then advances the cursor in its own
/// transaction. The resulting failure mode — a crash between the last
/// applied item and the cursor advance — is safe, not merely tolerated: every
/// apply is an idempotent upsert/delete keyed by stable record id, so
/// re-fetching and re-applying the same page after a restart (because the
/// cursor never moved) reaches the identical end state, the same
/// idempotent-retry safety net section "9. Server Idempotency" already
/// relies on for push. Recorded here as a real, honestly-scoped gap rather
/// than silently claimed closed.
extension RemoteSyncEngine {
    /// Pulls and applies as many pages as `maxPullPagesPerCall` allows,
    /// honoring the backoff gate the same way `pushPending()` does — see
    /// that method's own doc comment for why a coarser, in-memory,
    /// per-engine-instance gate (`pullFailureGate`) is this stage's
    /// deliberate scope for pull, which (unlike push) has no per-operation
    /// `retryState` to gate by at all.
    public func pullChanges() async throws {
        try await ensureClientRegistered()

        guard SyncBackoff.isEligible(
            attemptCount: pullFailureGate?.attemptCount ?? 0,
            lastAttemptedAt: pullFailureGate?.lastAttemptedAt,
            retryAfter: pullFailureGate?.retryAfterSeconds.map(TimeInterval.init),
            now: now(),
            randomUnitInterval: randomUnitInterval
        ) else {
            return
        }

        status = .synchronizing
        do {
            try await pullPages()
            pullFailureGate = nil
            try await refreshIdleStatus()
        } catch let error as APIGatewayError {
            let attemptCount = (pullFailureGate?.attemptCount ?? 0) + 1
            pullFailureGate = TransientFailureGate(
                attemptCount: attemptCount,
                lastAttemptedAt: now(),
                retryAfterSeconds: error.retryAfterSeconds
            )
            status = error.syncErrorCategory == .connectivity ? .waitingForConnectivity : .requiresAttention
            throw error
        }
    }

    /// Fetches and applies pages until a page returns fewer than
    /// `pullPageLimit` items (caught up) or `maxPullPagesPerCall` is reached.
    /// On a `409` requiring full resynchronization
    /// (`sync.changes.cursor_expired`/`sync.protocol_version.unsupported`),
    /// resets the cursor and retries once with `after` omitted; a second
    /// consecutive `409` is not retried again — it propagates to
    /// `pullChanges()`'s own catch, which records it and surfaces it as a
    /// real failure (architecture/offline-synchronization.md, section
    /// "13. Full Resynchronization").
    private func pullPages() async throws {
        var pagesFetched = 0
        var hasResyncedThisCall = false

        while pagesFetched < maxPullPagesPerCall {
            let cursor = try await cursorStore.current()
            do {
                let page = try await gateway.getChanges(
                    protocolVersion: protocolVersion,
                    after: cursor?.cursor,
                    limit: pullPageLimit
                )
                pagesFetched += 1
                try await applyPage(page)
                if page.items.count < pullPageLimit {
                    return
                }
            } catch let error as APIGatewayError {
                guard !hasResyncedThisCall, isFullResyncRequired(error) else { throw error }
                hasResyncedThisCall = true
                try await cursorStore.reset()
                // Retries from the top of the loop with the cursor cleared —
                // does not consume a page from `maxPullPagesPerCall`, since
                // no page was actually received.
            }
        }
        // Hit `maxPullPagesPerCall` without catching up — the cursor is
        // already durably advanced through the last page applied; a future
        // `pullChanges()` call resumes from exactly this point.
    }

    /// Applies every item in one page, then advances the durable cursor —
    /// see this file's own header comment for exactly what "atomically"
    /// means here versus the architecture document's literal wording.
    private func applyPage(_ page: SyncChangesPage) async throws {
        for item in page.items {
            try await apply(item)
        }
        try await cursorStore.advance(cursor: page.nextCursor, at: now())
    }

    /// Dispatches one pulled change to the registered `SyncPullRecordApplier`
    /// for its `recordType`, through the same `appliersByRecordType`
    /// dictionary `applyConfirmedRecords` already dispatches push outcomes
    /// through. A record type with no *pull-capable* applier registered —
    /// `calibration` (no applier at all) or `observation` (registered for
    /// push only — see `SyncPullRecordApplier`'s own doc comment) — is
    /// skipped, not an error, the same "not this client's job to project
    /// locally" posture push already takes.
    private func apply(_ item: SyncChange) async throws {
        // A `garden`/`delete` change is the access-revocation tombstone
        // (architecture/offline-synchronization.md, section "11.
        // Authorization Changes") — `item.recordId` names the garden itself
        // for this one record type (`GetSyncChanges`'s own server-side
        // comment: "the record IS the garden"), so it is also the cascade's
        // own `gardenId` scope. Runs BEFORE the ordinary single-applier
        // dispatch below, though order has no observable effect today:
        // `GardenSyncRecordApplier.applyDelete` stays the documented no-op
        // it already was — this cascade, not that method, is what actually
        // removes the garden's own local row now (via its own
        // `removeGardenScopedData(gardenId:)` conformance).
        if item.recordType == "garden", item.operation == .delete {
            try await removeGardenPartition(gardenId: item.recordId)
        }

        guard let applier = appliersByRecordType[item.recordType] as? any SyncPullRecordApplier else {
            return
        }

        switch item.operation {
        case .upsert:
            guard let snapshot = item.snapshot else {
                // The contract guarantees `record` is present for `upsert`
                // (`SyncChange`'s own doc comment); a defensive skip, not a
                // thrown error, mirrors `SyncRecordApplier
                // .applyUpsert(_:)`'s own defensive posture toward a
                // snapshot naming a record type the applier does not own.
                return
            }
            try await applier.applyUpsert(snapshot)
        case .delete:
            try await applier.applyDelete(recordId: item.recordId, gardenId: item.gardenId, revision: item.recordRevision)
        }
    }

    /// The garden-partition cascade reaction to a `garden`/`delete` pull
    /// change (P5-SEC-01) — see `CoreSynchronization.SyncRecordApplier
    /// .removeGardenScopedData(gardenId:)`'s own doc comment for the full
    /// per-applier contract this calls, once per registered applier,
    /// regardless of pull capability. `CoreSynchronization` never learns what
    /// `garden_object`/`plant`/`observation`/`task` are as concrete types
    /// here — only that every registered `SyncRecordApplier` owns some table
    /// scoped by `gardenId` and knows how to clear its own share of it.
    ///
    /// Also runs the two pieces of matching generic infrastructure this
    /// engine already owns directly, the same way `apply(_:to:)` already
    /// resolves `conflict`/`rejected` push outcomes without any feature
    /// applier involved:
    ///
    /// - Drops every still-pending `sync_outbox` row for the garden — "stop
    ///   stale pushes" (architecture/offline-synchronization.md, section
    ///   "11. Authorization Changes": "Pending operations against the garden
    ///   become rejected and cannot be retried under stale authorization").
    ///   The server already independently rejects a push against a garden
    ///   the caller lost membership on (every push route's own
    ///   `requireCapability`/`findActiveMembership` check, confirmed by
    ///   inspection — see this stage's own report), so this is a purely
    ///   client-side optimization: it avoids a guaranteed-futile round trip
    ///   and the transient "requires attention" status a rejected outcome
    ///   would otherwise show for an already-known-unrecoverable operation,
    ///   not a security boundary the server does not already enforce on its
    ///   own.
    /// - Drops every stale `SyncOperationResult` row for the garden —
    ///   operational bookkeeping for outbox operations this step just
    ///   removed, not itself "recovery information."
    ///
    /// Deliberately does NOT touch `conflictStore`: architecture/offline-
    /// synchronization.md, section "11. Authorization Changes" — "The client
    /// removes protected local garden data after preserving only
    /// policy-approved conflict or export recovery information" — matches
    /// section "15. Local Conflict Recovery"'s own framing of a
    /// `SyncConflict` as durable recovery information (original operation,
    /// both representations, suggested recovery actions), not operational
    /// bookkeeping. A conflict recorded for this garden stays exactly as
    /// durable as it already was; P5-CONFLICT-01 (a separate work package,
    /// out of this stage's scope) is what eventually gives a user any UI to
    /// review or export it after the garden itself is gone.
    private func removeGardenPartition(gardenId: String) async throws {
        for applier in appliersByRecordType.values {
            try await applier.removeGardenScopedData(gardenId: gardenId)
        }

        for operation in try await outboxStore.fetchPending(gardenId: gardenId) {
            try await outboxStore.remove(operationId: operation.id)
        }

        try await operationResultStore.removeAll(gardenId: gardenId)
    }

    /// Whether `error` is one of the two stable `409` codes architecture/
    /// offline-synchronization.md, section "13. Full Resynchronization"
    /// requires a full resync for.
    private func isFullResyncRequired(_ error: APIGatewayError) -> Bool {
        guard case let .service(body, statusCode, _) = error, statusCode == 409 else { return false }
        return body.code == SyncErrorCode.cursorExpired.rawValue
            || body.code == SyncErrorCode.protocolVersionUnsupported.rawValue
    }
}
