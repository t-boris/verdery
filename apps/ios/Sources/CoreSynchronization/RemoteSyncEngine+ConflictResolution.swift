import CoreDomain
import CoreNetworking
import CorePersistence
import Foundation

/// The narrow, mockable seam `FeatureSyncConflicts`'s view model depends on
/// — `RemoteSyncEngine` conforms below. A separate protocol from `SyncEngine`
/// itself: `LocalOnlySyncEngine` has no network round trip and so never
/// records a real conflict to resolve (`CoreDomain.SyncConflict` is a durable
/// record of a SERVER's rejection, which a local-only engine cannot produce),
/// so forcing it to implement conflict resolution would only ever be a
/// vacuous throw — the same "do not conform a type to a capability it
/// cannot honestly support" posture `ObservationSyncRecordApplier` already
/// takes toward `SyncPullRecordApplier`.
public protocol ConflictResolvingSyncEngine: Sendable {
    /// Resolves one durable conflict. `action` must be one of the three real
    /// resolution mechanisms — `.openForManualReview` is a UI presentation
    /// mode only (see `CoreDomain.SyncConflict`'s own doc comment on section
    /// "15. Local Conflict Recovery"), never a valid argument here, and
    /// throws `SyncConflictResolutionError.manualReviewIsNotAResolution` if
    /// passed — a caller UI bug, not a condition any real user action
    /// reaches, since `SyncConflictsViewModel` only ever dispatches an action
    /// present in `conflict.suggestedRecoveryActions`, which never includes
    /// it (`ConflictRecoveryPolicy.suggestedRecoveryActions` always appends
    /// `.openForManualReview` itself, separately from this dispatch).
    func resolveConflict(_ conflict: SyncConflict, action: ConflictRecoveryAction) async throws
}

/// Failure modes specific to conflict resolution — distinct from
/// `SyncErrorCategory`/`APIGatewayError`, which classify a PUSH/PULL
/// failure, not a local resolution-construction failure.
public enum SyncConflictResolutionError: Error, Equatable, Sendable {
    /// `action == .openForManualReview` — see `ConflictResolvingSyncEngine
    /// .resolveConflict(_:action:)`'s own doc comment.
    case manualReviewIsNotAResolution
    /// The conflict's own `originalOperationId` names a row `SyncOutboxStore`
    /// no longer has — should not happen in practice (the row is
    /// deliberately retained until a resolution is accepted; see
    /// `RemoteSyncEngine.apply(_:to:)`'s own `.conflict` branch comment) but
    /// defended against rather than force-unwrapped.
    case originalOperationMissing
    /// No applier is registered for `conflict.recordType` at all (`calibration`
    /// today; see `SyncRecordApplier`'s own doc comment), or the registered
    /// one does not conform to the capability `action` requires
    /// (`SyncConflictReplayableApplier`/`SyncConflictDuplicatingApplier`) —
    /// should not happen for an action `conflict.suggestedRecoveryActions`
    /// actually offered, since `ConflictRecoveryPolicy` and each feature's
    /// applier conformance are kept in lockstep, but defended against rather
    /// than force-unwrapped.
    case actionNotSupportedForRecordType
    /// The registered `SyncConflictDuplicatingApplier` judged `conflict`'s
    /// original operation unsuitable to duplicate from (multi-target, or no
    /// local row left to clone) — see that protocol's own doc comment.
    case duplicateNotAvailable
}

/// **Transaction atomicity — a real defect found during P5-QA-01, and this
/// follow-up's own fix.** Each of the three methods below originally issued
/// several independent `CorePersistence` store calls (`outboxStore.remove`,
/// `outboxStore.enqueue`, `conflictStore.remove`/`resolve`, plus a feature's
/// own `SyncPullRecordApplier.applyUpsert`) rather than one shared GRDB
/// transaction, unlike `commitOfflineMutation`/`commitOfflineAppend`'s own
/// guarantee for ordinary offline mutations (Stages 4a-4e). A crash between
/// separate calls could leave state inconsistent — concretely, for
/// `resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject`, a crash
/// between removing the stale original operation and enqueueing its
/// resolution was a genuine, permanent DATA-LOSS bug: `originalOperationId`
/// was already gone, so retrying the same resolution from the top threw
/// `originalOperationMissing` forever, with no path back to resubmitting the
/// user's own local intent.
///
/// **What this fix closes**: `outboxStore.remove`/`.enqueue` and
/// `conflictStore.resolve` in `resolveReapplyingLocalIntent`/
/// `resolveDuplicatingAsNewObject` now commit as one real transaction
/// (`SyncTransactionContext`, when `outboxConflictTransaction` is provided —
/// see that type's own doc comment) — a crash mid-sequence now always rolls
/// back to the pre-attempt state (the original operation still present,
/// still fetchable, ready for the exact same retry), never to the
/// in-between state that used to throw `originalOperationMissing`. This
/// fully closes the data-loss bug: the transaction is either wholly applied
/// or wholly absent, and the ONLY way to observe "wholly absent" is for the
/// original operation to still be there to retry from.
///
/// **What this fix deliberately does NOT close**: the feature-specific local
/// store write (`SyncPullRecordApplier.applyUpsert`, needed by
/// `resolveKeepingServerVersion` and `resolveDuplicatingAsNewObject`'s own
/// "restore the original to the server's version" step) stays a separate,
/// non-transactional call in every path. Three real reasons, investigated
/// rather than assumed:
///
/// 1. `conflict.recordType` selects WHICH feature's local store to write
///    through a runtime dictionary lookup (`appliersByRecordType`) — unlike
///    `GRDBGardenStore.commitOfflineMutation`'s own two-table case, which one
///    feature module's own code already knows both tables involved at
///    compile time, this engine genuinely does not know which concrete
///    store it needs until a conflict names it.
/// 2. Extending real, GRDB-transaction-scoped writes to that store would
///    require a NEW protocol requirement on `SyncPullRecordApplier` taking a
///    `SyncTransactionContext`, implemented by every one of the (currently
///    four: Garden, Map, Plant, Task) conforming feature adapters' own GRDB
///    stores — real, achievable work, but a genuinely larger, multi-module
///    change than this stage's own scope, not a "wrap it in a transaction"
///    one-file fix.
/// 3. `AppCompositionRoot.makeSyncEngine()` today opens a SEPARATE
///    `DatabaseQueue` for the sync stores than the one `local*Store()` opens
///    for each feature's own read model (confirmed by inspection, not
///    assumed) — even with (2) built, achieving one shared transaction would
///    also need that wiring consolidated onto a single `DatabaseQueue`
///    instance per profile, since two different `DatabaseQueue` connections
///    to the same SQLite file cannot share one GRDB transaction.
///
/// The residual risk this leaves is bounded and self-healing, not silent
/// corruption: `resolveKeepingServerVersion`'s own three steps were ALREADY
/// safely idempotent-retriable before this fix (see that method's own doc
/// comment) — no severe bug existed there. For `resolveDuplicatingAsNewObject`
/// specifically, a crash between the new transaction committing and the
/// separate `applyUpsert` running afterward leaves the original record
/// showing stale local content until the next ordinary server fetch/pull for
/// it — annoying, never permanent, and never data loss, the same
/// "idempotent re-application eventually converges" property
/// `RemoteSyncEngine+Pull.swift`'s own header comment already accepts for an
/// analogous, deliberately-scoped gap.
extension RemoteSyncEngine: ConflictResolvingSyncEngine {
    /// Resolves one durable conflict by one of the three real recovery
    /// mechanisms — architecture/offline-synchronization.md, section
    /// "15. Local Conflict Recovery".
    public func resolveConflict(_ conflict: SyncConflict, action: ConflictRecoveryAction) async throws {
        switch action {
        case .keepServerVersion:
            try await resolveKeepingServerVersion(conflict)
        case .reapplyLocalIntent:
            try await resolveReapplyingLocalIntent(conflict)
        case .duplicateAsNewObject:
            try await resolveDuplicatingAsNewObject(conflict)
        case .openForManualReview:
            throw SyncConflictResolutionError.manualReviewIsNotAResolution
        }
    }

    /// Overwrites the local record with `conflict.serverRepresentation` and
    /// closes the conflict immediately — no server round trip, so nothing to
    /// wait for.
    ///
    /// Removing the original outbox row FIRST, before the upsert, is what
    /// makes the upsert actually take effect: every `SyncPullRecordApplier
    /// .applyUpsert` reuses its feature's ordinary `save(_:)`, which
    /// deliberately skips writing over a record with a pending offline
    /// mutation still queued (see e.g. `LocalMapStore.save(_:)`'s own doc
    /// comment) — exactly the guard that must NOT protect the very mutation
    /// being discarded here. If this device queued a further pending
    /// mutation against the same record after the conflict was recorded,
    /// that guard still correctly protects THAT one.
    ///
    /// `observation` (no `SyncPullRecordApplier` conformance — see that
    /// protocol's own doc comment) falls through the `as?` cast to a no-op
    /// write: there is no local cache row to overwrite in the first place,
    /// so discarding the pending outbox row is already the full "keep
    /// server version" effect for it.
    ///
    /// **Not wrapped in `outboxConflictTransaction`, deliberately**: unlike
    /// `resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject`, this
    /// method's three steps were already safely idempotent-retriable before
    /// this stage's fix, so there is no severe bug here to close. Retrying
    /// this WHOLE method again after an interruption at any point — the
    /// conflict stays "open" (`conflictStore.fetchOpen`'s own filter) until
    /// the very last step, so the UI naturally re-offers exactly this same
    /// action — always succeeds: `outboxStore.remove` is a no-op for an
    /// already-removed row, `applyUpsert` is an idempotent upsert, and
    /// `conflictStore.remove` is a no-op for an already-removed row. No step
    /// has a precondition (like `resolveReapplyingLocalIntent`'s own
    /// `fetch`-or-throw) that a partial prior attempt could invalidate, so
    /// there is no `originalOperationMissing`-style dead end to close here.
    private func resolveKeepingServerVersion(_ conflict: SyncConflict) async throws {
        try await outboxStore.remove(operationId: conflict.originalOperationId)

        if let applier = appliersByRecordType[conflict.recordType] as? any SyncPullRecordApplier {
            let snapshot = try SyncRecordSnapshotDecoding.decode(json: conflict.serverRepresentation)
            try await applier.applyUpsert(snapshot)
        }

        try await conflictStore.remove(conflictId: conflict.id)
    }

    /// Enqueues a new outbox operation carrying the original local intent
    /// against the server's current revision, tagged so ITS eventual
    /// `accepted`/`duplicate` confirmation — not this call — closes
    /// `conflict` (`OutboxOperation.resolvesConflictId`; see
    /// `RemoteSyncEngine.apply(_:to:)`'s own `.accepted`/`.duplicate`
    /// branch). `conflictStore.resolve(conflictId:resolutionOperationId:at:)`
    /// marks it no longer "open" (`SyncConflictStore.fetchOpen`'s own filter)
    /// immediately, but the row itself is NOT removed here — the two-step
    /// timing architecture/offline-synchronization.md, section "15. Local
    /// Conflict Recovery" requires ("closes the prior conflict only after
    /// the resolution is accepted").
    ///
    /// The ORIGINAL operation is removed as part of this call, not left in
    /// the outbox: it carries the same stale `expectedRevision` that just
    /// conflicted, so leaving it pending would make a future `pushPending()`
    /// resubmit it unchanged and record a second, redundant conflict for the
    /// same underlying mutation — the new resolution operation supersedes
    /// it, the same "the original is being replaced, not merely
    /// supplemented" reasoning `resolveDuplicatingAsNewObject`'s own removal
    /// of the original (for a different reason — its object is kept as the
    /// server's version) already establishes.
    ///
    /// The removal and the new operation's enqueue, plus marking `conflict`
    /// resolved, all happen through `removeOriginalAndEnqueueResolution`'s
    /// own shared, transaction-scoped-when-available implementation — see
    /// that method's own doc comment, and this file's own header comment,
    /// for why: before this stage's fix, a crash between the removal and the
    /// enqueue left `conflict.originalOperationId` permanently unfetchable,
    /// so retrying this very method threw `originalOperationMissing`
    /// forever, losing the user's own local intent for good.
    private func resolveReapplyingLocalIntent(_ conflict: SyncConflict) async throws {
        guard let original = try await outboxStore.fetch(operationId: conflict.originalOperationId) else {
            throw SyncConflictResolutionError.originalOperationMissing
        }
        guard let applier = appliersByRecordType[conflict.recordType] as? any SyncConflictReplayableApplier else {
            throw SyncConflictResolutionError.actionNotSupportedForRecordType
        }

        let serverSnapshot = try SyncRecordSnapshotDecoding.decode(json: conflict.serverRepresentation)
        guard let newRevision = serverSnapshot.revision else {
            throw SyncConflictResolutionError.actionNotSupportedForRecordType
        }

        let draft = try applier.reapplyDraft(original: original, newExpectedRevision: newRevision)
        try await removeOriginalAndEnqueueResolution(draft, original: original, closing: conflict)
    }

    /// Enqueues a new CREATE-shaped outbox operation duplicating this
    /// device's own local version of the conflicting record as a brand-new
    /// record, and separately restores the server's version onto the
    /// ORIGINAL record — the same immediate, no-round-trip effect
    /// `resolveKeepingServerVersion` performs, since the original is not
    /// being superseded, only duplicated alongside. The new operation is
    /// tagged and left open exactly like `resolveReapplyingLocalIntent`'s
    /// own — the conflict closes only once IT is confirmed.
    ///
    /// The original's removal, the new operation's enqueue, and marking
    /// `conflict` resolved happen first, as one unit
    /// (`removeOriginalAndEnqueueResolution`) — closing the same
    /// `originalOperationMissing`-after-crash data-loss bug
    /// `resolveReapplyingLocalIntent`'s own doc comment describes, which
    /// applied here identically before this stage's fix. Restoring the
    /// original to the server's version runs AFTER that unit completes, not
    /// before and not inside it: it needs the original's removal to already
    /// be durably visible for the same "pending mutation" guard
    /// `resolveKeepingServerVersion`'s own doc comment explains, and — per
    /// this file's own header comment — extending real transaction scope to
    /// a feature's own local store is a genuinely larger change this stage
    /// does not make. A crash in the narrow window between the transaction
    /// committing and this call is a bounded, self-healing staleness on the
    /// original record, not data loss — see this file's own header comment.
    private func resolveDuplicatingAsNewObject(_ conflict: SyncConflict) async throws {
        guard let original = try await outboxStore.fetch(operationId: conflict.originalOperationId) else {
            throw SyncConflictResolutionError.originalOperationMissing
        }
        guard let applier = appliersByRecordType[conflict.recordType] as? any SyncConflictDuplicatingApplier else {
            throw SyncConflictResolutionError.actionNotSupportedForRecordType
        }
        guard let draft = try await applier.duplicateDraft(original: original, newRecordId: generateOperationId()) else {
            throw SyncConflictResolutionError.duplicateNotAvailable
        }

        try await removeOriginalAndEnqueueResolution(draft, original: original, closing: conflict)

        if let pullApplier = applier as? any SyncPullRecordApplier {
            let serverSnapshot = try SyncRecordSnapshotDecoding.decode(json: conflict.serverRepresentation)
            try await pullApplier.applyUpsert(serverSnapshot)
        }
    }

    /// Shared by `resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject`:
    /// builds the new `OutboxOperation` from a feature's own draft plus the
    /// generic bookkeeping fields only the engine fills, then removes
    /// `original` from the outbox, enqueues the new operation, and marks
    /// `conflict` resolved by its id — without removing the conflict row,
    /// which stays until that new operation's own push is confirmed.
    ///
    /// These three writes commit as one real GRDB transaction when
    /// `outboxConflictTransaction` is available (`SyncTransactionContext`'s
    /// own doc comment has the full reasoning) — added by this stage's own
    /// fix for the P5-QA-01 defect this file's own header comment documents.
    /// Falls back to the original three-separate-calls sequence when it is
    /// `nil` (every existing test double, and `AppCompositionRoot`'s
    /// in-memory fallback), unchanged in observable behavior from before
    /// this stage.
    @discardableResult
    private func removeOriginalAndEnqueueResolution(
        _ draft: ConflictResolutionOperationDraft,
        original: OutboxOperation,
        closing conflict: SyncConflict
    ) async throws -> OutboxOperation {
        let resolutionOperation = OutboxOperation(
            id: generateOperationId(),
            profileId: original.profileId,
            gardenId: original.gardenId,
            commandType: draft.commandType,
            commandVersion: draft.commandVersion,
            targetRecordIds: draft.targetRecordIds,
            expectedRevision: draft.expectedRevision,
            payload: draft.payload,
            resolvesConflictId: conflict.id,
            createdAt: now()
        )

        if let transaction = outboxConflictTransaction {
            try await transaction.run { context in
                try context.removeOutboxOperation(operationId: original.id)
                try context.enqueueOutboxOperation(resolutionOperation)
                try context.resolveConflict(
                    conflictId: conflict.id,
                    resolutionOperationId: resolutionOperation.id,
                    at: resolutionOperation.createdAt
                )
            }
        } else {
            try await outboxStore.remove(operationId: original.id)
            try await outboxStore.enqueue(resolutionOperation)
            try await conflictStore.resolve(
                conflictId: conflict.id,
                resolutionOperationId: resolutionOperation.id,
                at: resolutionOperation.createdAt
            )
        }

        return resolutionOperation
    }
}
