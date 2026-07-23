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
    /// synchronization.md, section "11. Authorization Changes"), and
    /// "removing protected local garden data" is explicitly P5-SEC-01's own,
    /// later work package — see `CoreSynchronization.RemoteSyncEngine+Pull
    /// .swift`'s own header comment for why this stage stops at correctly
    /// DELIVERING and durably RECORDING that the tombstone was pulled (the
    /// cursor still advances past it, in `applyPage(_:)`) rather than
    /// reacting to it. Reacting would mean deciding what "protected local
    /// data" means for a garden's own row here — plausibly defensible on its
    /// own — but P5-SEC-01 is also expected to decide the SAME question for
    /// `garden_object`/`plant`/`observation`/`task` rows still cached under
    /// this garden, which this method has no way to reach or coordinate
    /// with; doing one third of that job here, ahead of the rest, would be
    /// a partial, inconsistent reaction rather than a complete one.
    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {}
}
