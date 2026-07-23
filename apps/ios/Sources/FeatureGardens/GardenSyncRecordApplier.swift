import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "garden"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`).
public struct GardenSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier {
    public let recordType = "garden"

    private let localStore: any LocalGardenStore

    public init(localStore: any LocalGardenStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(gardenId: recordId, revision: revision)
    }

    /// Reuses `LocalGardenStore.save(_:)` unchanged — the exact same
    /// "server-confirmed write, except when a pending offline mutation for
    /// this garden is still queued" guard a pulled garden from another
    /// device/session needs is already what `save(_:)` implements for a
    /// first-time server fetch (`GetGarden`/`ListGardens`); pull is simply a
    /// second real caller of it, not a new code path.
    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .garden(garden) = snapshot else { return }
        try await localStore.save(garden)
    }

    /// A deliberate no-op, not an oversight: a `garden`/`delete` change is
    /// the access-revocation tombstone (architecture/offline-
    /// synchronization.md, section "11. Authorization Changes"). Reacting to
    /// it — removing this garden's own local row, and every
    /// `garden_object`/`plant`/`observation`/`task` row still cached under
    /// it — is now P5-SEC-01's own `removeGardenScopedData(gardenId:)`
    /// below, invoked directly by `RemoteSyncEngine+Pull.swift`'s own
    /// garden-partition cascade for EVERY registered applier the moment a
    /// `garden`/`delete` change is seen, not routed back through this
    /// ordinary single-applier `applyDelete` dispatch — see that cascade's
    /// own doc comment for why. This method stays a no-op so the cascade
    /// remains the one, coherent place that reaction happens, rather than
    /// splitting "remove the garden's own row" across two call sites.
    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {}

    /// The one case among this codebase's five `removeGardenScopedData`
    /// conformers where `gardenId` names the applier's OWN record, not a
    /// record scoped underneath it (see that protocol requirement's own doc
    /// comment) — removes the garden's own local row.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.remove(gardenId: gardenId)
    }
}
