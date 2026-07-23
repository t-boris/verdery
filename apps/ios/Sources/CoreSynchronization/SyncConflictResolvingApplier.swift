import CoreDomain
import Foundation

/// Everything `RemoteSyncEngine+ConflictResolution.swift` needs to build a
/// new resolution `OutboxOperation`, except the generic bookkeeping fields
/// (`id`, `profileId`, `gardenId`, `createdAt`, `resolvesConflictId`) the
/// engine itself already knows how to fill without any feature-specific
/// help — the same split `SyncRecordApplier.applyConfirmed`'s own doc
/// comment draws between what the engine owns generically and what only a
/// feature's own applier can compute.
public struct ConflictResolutionOperationDraft: Sendable, Equatable {
    public let commandType: String
    public let commandVersion: Int
    public let targetRecordIds: [String]
    public let expectedRevision: Int?
    /// The exact `OutboxOperation.payload` wire text for the new operation —
    /// built by the owning feature from its own command payload types, the
    /// same "only the feature that created it... reshapes it" carve-out
    /// `OutboxOperation.payload`'s own doc comment already draws.
    public let payload: String

    public init(commandType: String, commandVersion: Int, targetRecordIds: [String], expectedRevision: Int?, payload: String) {
        self.commandType = commandType
        self.commandVersion = commandVersion
        self.targetRecordIds = targetRecordIds
        self.expectedRevision = expectedRevision
        self.payload = payload
    }
}

/// The additional capability some `SyncRecordApplier`s support: building the
/// "reapply local intent" resolution operation for a conflict
/// (P5-CONFLICT-01) — architecture/offline-synchronization.md, section
/// "14.5 Geometry" ("Reapply the local intent to the current version where
/// the operation is safely replayable").
///
/// A separate, optional-to-conform-to protocol, the same shape
/// `SyncPullRecordApplier` already establishes: `FeatureObservations
/// .ObservationSyncRecordApplier` conforms to neither, since observation
/// commands carry no `expectedRevision` at all to correct (see
/// `ConflictRecoveryPolicy`'s own doc comment) — there is genuinely nothing
/// for it to reapply.
///
/// `RemoteSyncEngine` discovers conformance with
/// `as? any SyncConflictReplayableApplier` against the same
/// `appliersByRecordType` dictionary every other dispatch already uses.
public protocol SyncConflictReplayableApplier: SyncRecordApplier {
    /// Builds the reapply draft: `original`'s own `commandType`/
    /// `commandVersion`/`targetRecordIds`, and a payload identical to
    /// `original.payload` except its embedded `expectedRevision` updated to
    /// `newExpectedRevision` (the server's current revision, decoded from
    /// the conflict's `serverRepresentation`).
    ///
    /// Only ever called for a command type `ConflictRecoveryPolicy
    /// .isSafelyReplayable(commandType:)` already judged safe — but this
    /// method still validates that on its own (throwing this feature's own
    /// command error otherwise) as a defense-in-depth backstop against a
    /// caller bypassing that policy, not because the caller is expected to.
    func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft
}

/// The additional capability only `FeatureMap.MapSyncRecordApplier` supports
/// today: building the "duplicate as new object" resolution operation for a
/// `gardenObject` conflict (P5-CONFLICT-01) — section "14.5 Geometry"
/// ("Duplicate as a new object when semantically valid"). See
/// `ConflictRecoveryPolicy`'s own doc comment for why no other record type
/// offers this action at all.
public protocol SyncConflictDuplicatingApplier: SyncRecordApplier {
    /// Builds a CREATE-shaped draft that duplicates THIS DEVICE's own
    /// current local cache row for `original`'s single target record — not a
    /// value recomputed from `original`'s own (possibly relative, possibly
    /// structurally stale) command payload — as a brand-new record carrying
    /// `newRecordId`. `nil` when `original` does not name exactly one target
    /// record (multi-target commands have no unambiguous single record to
    /// duplicate) or when this device has no local row left to clone from.
    func duplicateDraft(original: OutboxOperation, newRecordId: String) async throws -> ConflictResolutionOperationDraft?
}
