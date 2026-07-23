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
