import CoreDomain
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureObservations

/// Proves `ObservationSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalObservationStore.markSynced(observationId:)` — ignoring `revision`
/// entirely, since `GardenObservation` carries none (see that type's own
/// doc comment) — through a real `InMemoryObservationStore`, the same
/// "fake/in-memory local store proving the right store method gets called"
/// coverage this work package calls for.
@Suite("Observation sync record applier")
struct ObservationSyncRecordApplierTests {
    private func observation(id: String) -> GardenObservation {
        GardenObservation(
            id: id, gardenId: "garden-1", plantId: nil, gardenObjectId: nil, actorType: .user,
            createdByProfileId: nil, noteText: "Looking healthy", conditionSummary: nil,
            correctionKind: nil, correctsObservationId: nil, isCorrected: false,
            observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: []
        )
    }

    @Test("recordType is 'observation', matching the contract's SyncRecordType")
    func recordTypeIsObservation() {
        let applier = ObservationSyncRecordApplier(localStore: InMemoryObservationStore())
        #expect(applier.recordType == "observation")
    }

    @Test("applyConfirmed removes the observation's local pending row, regardless of the revision passed")
    func applyConfirmedRemovesPendingRow() async throws {
        let store = InMemoryObservationStore()
        _ = try await store.commitOfflineAppend(observation(id: "obs-1"), operation: OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "observations.record",
            commandVersion: 1, targetRecordIds: ["obs-1"], expectedRevision: nil,
            payload: #"{"recordType":"observation"}"#, createdAt: Date(timeIntervalSince1970: 0)
        ))
        let applier = ObservationSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "obs-1", revision: 1, confirmedAt: Date())

        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
    }
}
