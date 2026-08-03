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
    var nextDispositionFailure: Error?
    /// The sequence `listPlantJournalFrames` serves, and every narrowing it was asked for.
    var journalFrames: [PlantJournalFrame] = []
    var nextJournalFailure: Error?
    private(set) var journalFrameRequests: [ObservationPhotoPurpose?] = []

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
        photos: [ObservationPhotoAttachment],
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

    /// Scriptable journal frames. Empty unless a test sets them: a fake that
    /// invented a sequence would let a journal test pass on data no production
    /// path produced.
    func listPlantJournalFrames(
        gardenId: String,
        plantId: String,
        purpose: ObservationPhotoPurpose?,
        limit: Int?
    ) async throws -> [PlantJournalFrame] {
        journalFrameRequests.append(purpose)
        if let nextJournalFailure { throw nextJournalFailure }
        guard let purpose else { return journalFrames }
        return journalFrames.filter { $0.purpose == purpose }
    }

    func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photos: [ObservationPhotoAttachment],
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

    /// Finds the named `ImageAnalysisResult` inside whichever observation's
    /// photo carries it and rewrites its disposition fields — a real, if
    /// deeply nested, in-memory update, matching the real server's own
    /// "narrow, disposition-only" mutation (`image_analysis_result` is
    /// otherwise append-only).
    func setHealthSuggestionDisposition(
        analysisResultId: String,
        disposition: HealthSuggestionDisposition,
        idempotencyKey: String
    ) async throws -> ImageAnalysisResult {
        if let nextDispositionFailure {
            self.nextDispositionFailure = nil
            throw nextDispositionFailure
        }

        for (observationIndex, observation) in observations.enumerated() {
            for (photoIndex, photo) in observation.photos.enumerated() {
                guard let resultIndex = photo.analysisResults.firstIndex(where: { $0.id == analysisResultId })
                else { continue }

                let original = photo.analysisResults[resultIndex]
                let updated = ImageAnalysisResult(
                    id: original.id,
                    analysisKind: original.analysisKind,
                    suggestedLabel: original.suggestedLabel,
                    confidenceScore: original.confidenceScore,
                    requiresConfirmation: original.requiresConfirmation,
                    requestedAdditionalEvidence: original.requestedAdditionalEvidence,
                    evidenceSummary: original.evidenceSummary,
                    alternativeExplanations: original.alternativeExplanations,
                    safetyClass: original.safetyClass,
                    requestedViewPurposes: original.requestedViewPurposes,
                    modelName: original.modelName,
                    promptVersion: original.promptVersion,
                    disposition: disposition,
                    dispositionSetAt: Date(timeIntervalSince1970: 2),
                    dispositionSetByProfileId: "profile-1",
                    createdAt: original.createdAt
                )

                var updatedResults = photo.analysisResults
                updatedResults[resultIndex] = updated
                let updatedPhoto = ObservationPhoto(
                    id: photo.id, mediaId: photo.mediaId, purpose: photo.purpose,
                    createdAt: photo.createdAt, analysisResults: updatedResults
                )
                var updatedPhotos = observation.photos
                updatedPhotos[photoIndex] = updatedPhoto
                observations[observationIndex] = GardenObservation(
                    id: observation.id, gardenId: observation.gardenId, plantId: observation.plantId,
                    gardenObjectId: observation.gardenObjectId, actorType: observation.actorType,
                    createdByProfileId: observation.createdByProfileId, noteText: observation.noteText,
                    conditionSummary: observation.conditionSummary, correctionKind: observation.correctionKind,
                    correctsObservationId: observation.correctsObservationId, isCorrected: observation.isCorrected,
                    observedAt: observation.observedAt, recordedAt: observation.recordedAt, photos: updatedPhotos
                )
                return updated
            }
        }

        throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-missing-analysis-result")
    }
}
