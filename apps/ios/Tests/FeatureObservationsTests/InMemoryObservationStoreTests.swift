import CoreDomain
import Foundation
import Testing

@testable import FeatureObservations

@Suite("In-memory observation store")
struct InMemoryObservationStoreTests {
    private func observation(id: String, gardenId: String = "garden-1", plantId: String? = "plant-1") -> GardenObservation {
        GardenObservation(
            id: id, gardenId: gardenId, plantId: plantId, gardenObjectId: nil, actorType: .user,
            createdByProfileId: nil, noteText: "Looking healthy", conditionSummary: nil,
            correctionKind: nil, correctsObservationId: nil, isCorrected: false,
            observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: []
        )
    }

    private func operation(id: String, observationId: String, gardenId: String = "garden-1") -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "observations.record",
            commandVersion: 1,
            targetRecordIds: [observationId],
            expectedRevision: nil,
            payload: #"{"recordType":"observation"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("Starts empty")
    func startsEmpty() async throws {
        let store = InMemoryObservationStore()
        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
    }

    @Test("commitOfflineAppend appends the observation and returns it")
    func commitOfflineAppendAppends() async throws {
        let store = InMemoryObservationStore()
        let created = observation(id: "obs-1")

        let result = try await store.commitOfflineAppend(created, operation: operation(id: "op-1", observationId: "obs-1"))

        #expect(result == created)
        #expect(try await store.fetchPending(gardenId: "garden-1") == [created])
    }

    @Test("commitOfflineAppend accumulates multiple rows for the same garden")
    func commitOfflineAppendAccumulates() async throws {
        let store = InMemoryObservationStore()
        let first = observation(id: "obs-1")
        let second = observation(id: "obs-2")

        _ = try await store.commitOfflineAppend(first, operation: operation(id: "op-1", observationId: "obs-1"))
        _ = try await store.commitOfflineAppend(second, operation: operation(id: "op-2", observationId: "obs-2"))

        #expect(try await store.fetchPending(gardenId: "garden-1") == [first, second])
    }

    @Test("fetchPending scopes strictly by gardenId")
    func fetchPendingScopesByGarden() async throws {
        let store = InMemoryObservationStore()
        let inGardenOne = observation(id: "obs-1", gardenId: "garden-1")
        let inGardenTwo = observation(id: "obs-2", gardenId: "garden-2")

        _ = try await store.commitOfflineAppend(inGardenOne, operation: operation(id: "op-1", observationId: "obs-1", gardenId: "garden-1"))
        _ = try await store.commitOfflineAppend(inGardenTwo, operation: operation(id: "op-2", observationId: "obs-2", gardenId: "garden-2"))

        #expect(try await store.fetchPending(gardenId: "garden-1") == [inGardenOne])
        #expect(try await store.fetchPending(gardenId: "garden-2") == [inGardenTwo])
    }

    @Test("markSynced removes the confirmed observation, leaving the rest of the garden's pending set untouched")
    func markSyncedRemovesConfirmedObservation() async throws {
        let store = InMemoryObservationStore()
        let first = observation(id: "obs-1")
        let second = observation(id: "obs-2")
        _ = try await store.commitOfflineAppend(first, operation: operation(id: "op-1", observationId: "obs-1"))
        _ = try await store.commitOfflineAppend(second, operation: operation(id: "op-2", observationId: "obs-2"))

        try await store.markSynced(observationId: "obs-1")

        #expect(try await store.fetchPending(gardenId: "garden-1") == [second])
    }

    @Test("markSynced is a silent no-op for an observation this device has no local row for")
    func markSyncedNoOpForUnknownObservation() async throws {
        let store = InMemoryObservationStore()
        try await store.markSynced(observationId: "unknown")
        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
    }
}
