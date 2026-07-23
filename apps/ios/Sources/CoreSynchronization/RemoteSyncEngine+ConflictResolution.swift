import CoreDomain
import CoreNetworking
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
        try await outboxStore.remove(operationId: conflict.originalOperationId)
        try await enqueueResolution(draft, original: original, closing: conflict)
    }

    /// Enqueues a new CREATE-shaped outbox operation duplicating this
    /// device's own local version of the conflicting record as a brand-new
    /// record, and separately restores the server's version onto the
    /// ORIGINAL record — the same immediate, no-round-trip effect
    /// `resolveKeepingServerVersion` performs, since the original is not
    /// being superseded, only duplicated alongside (its own doc comment's
    /// ordering reasoning applies identically here). The new operation is
    /// tagged and left open exactly like `resolveReapplyingLocalIntent`'s
    /// own — the conflict closes only once IT is confirmed.
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

        try await outboxStore.remove(operationId: conflict.originalOperationId)
        if let pullApplier = applier as? any SyncPullRecordApplier {
            let serverSnapshot = try SyncRecordSnapshotDecoding.decode(json: conflict.serverRepresentation)
            try await pullApplier.applyUpsert(serverSnapshot)
        }

        try await enqueueResolution(draft, original: original, closing: conflict)
    }

    /// Shared by `resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject`:
    /// builds the new `OutboxOperation` from a feature's own draft plus the
    /// generic bookkeeping fields only the engine fills, enqueues it, and
    /// marks `conflict` resolved by its id — without removing the conflict
    /// row, which stays until that new operation's own push is confirmed.
    private func enqueueResolution(
        _ draft: ConflictResolutionOperationDraft,
        original: OutboxOperation,
        closing conflict: SyncConflict
    ) async throws {
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
        try await outboxStore.enqueue(resolutionOperation)
        try await conflictStore.resolve(conflictId: conflict.id, resolutionOperationId: resolutionOperation.id, at: now())
    }
}
