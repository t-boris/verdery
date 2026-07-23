import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "observation"` —
/// registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Ignores `revision`: `GardenObservation` carries none at all (append-only
/// by domain design — see that type's own doc comment), so "confirmed" only
/// ever means "remove this device's own local pending trace of it" — see
/// `LocalObservationStore.markSynced(observationId:)`'s own doc comment.
///
/// **Deliberately does NOT conform to `CoreSynchronization
/// .SyncPullRecordApplier`** (P5-IOS-03, Stage 5b): `LocalObservationStore`
/// maintains no full local cache of confirmed observations at all — only
/// THIS device's own not-yet-synced rows (`fetchPending(gardenId:)`'s own
/// doc comment). A genuinely new observation pulled from another device has
/// nowhere real to be written; it simply appears the next time
/// `ListObservationsForGarden`/`ListObservationsForPlant` fetches from the
/// network, exactly as it always has. `RemoteSyncEngine.pullChanges()`
/// skips `observation` changes generically (no pull-capable applier
/// registered for that record type) rather than this type carrying a
/// vacuous no-op `applyUpsert`/`applyDelete` — see `SyncPullRecordApplier`'s
/// own doc comment for why that is the more honest shape.
///
/// Source: implementation-plan.md work package P5-IOS-03, Stage 5a.
public struct ObservationSyncRecordApplier: SyncRecordApplier {
    public let recordType = "observation"

    private let localStore: any LocalObservationStore

    public init(localStore: any LocalObservationStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.markSynced(observationId: recordId)
    }
}
