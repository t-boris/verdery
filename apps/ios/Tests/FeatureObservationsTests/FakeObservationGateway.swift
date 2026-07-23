import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the real API — mirrors
/// `FeaturePlantsTests/FakePlantGateway`'s role for `FeatureObservations`'s
/// own view-model tests.
final class FakeObservationGateway: ObservationGateway, @unchecked Sendable {
    private var observations: [GardenObservation] = []
    var nextRecordFailure: Error?
    var nextCorrectionFailure: Error?
    /// Set by a test that wants to simulate the network being unreachable
    /// for `listObservationsForGarden`/`listObservationsForPlant` — what
    /// `ObservationsTimelineViewModel.load()`'s pending-fallback path
    /// (P5-IOS-02, Stage 4d) actually needs coverage of. Not consumed
    /// (unlike `nextRecordFailure`/`nextCorrectionFailure`): a `load()`
    /// test typically wants every subsequent list call in the same test to
    /// keep failing, not just the first.
    var nextListFailure: Error?

    init(observations: [GardenObservation] = []) {
        self.observations = observations
    }

    /// Test-only hook: appends an observation directly, bypassing
    /// `recordObservation`'s own id generation — lets a test simulate "the
    /// server already knows about this exact (client-generated) id," the
    /// scenario a future push engine would eventually create once one
    /// exists (P5-IOS-03, not yet built).
    func seedConfirmed(_ observation: GardenObservation) {
        observations.append(observation)
    }

    func recordObservation(
        gardenId: String,
        plantId: String?,
        gardenObjectId: String?,
        noteText: String?,
        conditionSummary: String?,
        observedAt: Date?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation {
        if let nextRecordFailure {
            self.nextRecordFailure = nil
            throw nextRecordFailure
        }

        let observation = GardenObservation(
            id: "obs-\(observations.count + 1)",
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: gardenObjectId,
            actorType: .user,
            createdByProfileId: "profile-1",
            noteText: noteText,
            conditionSummary: conditionSummary,
            correctionKind: nil,
            correctsObservationId: nil,
            isCorrected: false,
            observedAt: observedAt ?? Date(timeIntervalSince1970: 0),
            recordedAt: Date(timeIntervalSince1970: 0),
            photos: []
        )
        observations.append(observation)
        return observation
    }

    func listObservationsForGarden(gardenId: String) async throws -> [GardenObservation] {
        if let nextListFailure { throw nextListFailure }
        return observations
    }

    func listObservationsForPlant(gardenId: String, plantId: String) async throws -> [GardenObservation] {
        if let nextListFailure { throw nextListFailure }
        return observations.filter { $0.plantId == plantId }
    }

    func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation {
        if let nextCorrectionFailure {
            self.nextCorrectionFailure = nil
            throw nextCorrectionFailure
        }

        guard let originalIndex = observations.firstIndex(where: { $0.id == observationId }) else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-missing-observation")
        }

        let original = observations[originalIndex]
        observations[originalIndex] = GardenObservation(
            id: original.id, gardenId: original.gardenId, plantId: original.plantId,
            gardenObjectId: original.gardenObjectId, actorType: original.actorType,
            createdByProfileId: original.createdByProfileId, noteText: original.noteText,
            conditionSummary: original.conditionSummary, correctionKind: original.correctionKind,
            correctsObservationId: original.correctsObservationId, isCorrected: true,
            observedAt: original.observedAt, recordedAt: original.recordedAt, photos: original.photos
        )

        let correction = GardenObservation(
            id: "obs-\(observations.count + 1)",
            gardenId: original.gardenId,
            plantId: original.plantId,
            gardenObjectId: original.gardenObjectId,
            actorType: .user,
            createdByProfileId: "profile-1",
            noteText: noteText,
            conditionSummary: conditionSummary,
            correctionKind: correctionKind,
            correctsObservationId: original.id,
            isCorrected: false,
            observedAt: original.observedAt,
            recordedAt: Date(timeIntervalSince1970: 1),
            photos: []
        )
        observations.append(correction)
        return correction
    }
}
