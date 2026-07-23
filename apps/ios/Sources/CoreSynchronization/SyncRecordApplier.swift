import CoreDomain
import Foundation

/// The seam a feature module implements so `RemoteSyncEngine` can apply a
/// confirmed push outcome back to that feature's own local read model,
/// without `CoreSynchronization` ever importing a `Feature*` module — the
/// same "shared type one level below both layers" resolution
/// `SyncEngine.swift`'s own doc comment already uses for `OutboxOperation`/
/// `AuthTokenProvider`, applied in the opposite direction here:
/// `CoreSynchronization`'s engine calls this protocol generically, and only
/// `AppCompositionRoot` — the one place allowed to import both
/// `CoreSynchronization` and every feature — ever names a concrete
/// conformer, registering it with `RemoteSyncEngine` at construction time.
///
/// Shaped around exactly one of the six push outcomes
/// (architecture/offline-synchronization.md, section "8. Push Protocol"):
/// `accepted`/`duplicate`, the only two where an existing local record's own
/// state must change. `RemoteSyncEngine` resolves the other four with
/// generic infrastructure already built in Phase 5 Stage 3, no feature
/// involvement needed at all:
///
/// - `conflict`: a durable `CoreDomain.SyncConflict`, written through
///   `CorePersistence.SyncConflictStore`. Every field it needs
///   (`conflictCode`, the server's current representation, the original
///   operation's own payload as `localRepresentation`) comes off the wire
///   response and the pushed `OutboxOperation` itself.
/// - `rejected`: a durable `CoreDomain.SyncOperationResult`, written through
///   `CorePersistence.SyncOperationResultStore` — same reasoning.
/// - `blockedByDependency`/`retryLater`: no local storage change of any
///   kind; the outbox row stays untouched for a future push attempt.
///
/// Only `accepted`/`duplicate` need a feature's own local store touched:
/// the pending record this device already projected optimistically must
/// have its revision advanced to the server's now-confirmed value, and only
/// the feature that owns that record type knows how to load and re-save it.
public protocol SyncRecordApplier: Sendable {
    /// The `SyncRecordType` wire value this applier owns — `"garden"`,
    /// `"gardenObject"`, `"plant"`, `"observation"`, or `"task"` — matching
    /// `packages/api-contracts/openapi.yaml`'s `SyncRecordType`/
    /// `SyncRecordReference.recordType` exactly. A plain `String`, not yet
    /// an enum, for the same reason `CoreDomain.SyncConflict.conflictCode`
    /// stays a `String`: this client's synchronization vocabulary is not
    /// pinned to a contract-owned enum anywhere else either.
    var recordType: String { get }

    /// Applies an `accepted` or `duplicate` outcome for one record this
    /// applier owns: advances the local projection to the server's
    /// confirmed revision. A silent no-op when this device has no local row
    /// for `recordId` — already removed, or never cached — the same
    /// defensive posture every `Local*Store.save`/`replaceAll` method
    /// already takes toward a record it does not know about.
    func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws
}
