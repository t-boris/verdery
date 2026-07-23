import CoreDomain
import Foundation

/// Wire shapes of the observation operations. See `PlantTransport.swift`'s
/// doc comment for why these enums code by straight synthesis.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Observations`.
struct ImageAnalysisResultTransport: Codable {
    let id: String
    let analysisKind: ImageAnalysisKind
    let suggestedLabel: String
    let confidenceScore: Double
    let requiresConfirmation: Bool
    let requestedAdditionalEvidence: Bool
    let createdAt: Date

    var domainValue: ImageAnalysisResult {
        ImageAnalysisResult(
            id: id,
            analysisKind: analysisKind,
            suggestedLabel: suggestedLabel,
            confidenceScore: confidenceScore,
            requiresConfirmation: requiresConfirmation,
            requestedAdditionalEvidence: requestedAdditionalEvidence,
            createdAt: createdAt
        )
    }
}

struct ObservationPhotoTransport: Codable {
    let id: String
    let mediaId: String
    let createdAt: Date
    let analysisResults: [ImageAnalysisResultTransport]

    var domainValue: ObservationPhoto {
        ObservationPhoto(
            id: id,
            mediaId: mediaId,
            createdAt: createdAt,
            analysisResults: analysisResults.map(\.domainValue)
        )
    }
}

struct ObservationTransport: Codable {
    let id: String
    let gardenId: String
    let plantId: String?
    let gardenObjectId: String?
    let actorType: ObservationActorType
    let createdByProfileId: String?
    let noteText: String?
    let conditionSummary: String?
    let correctionKind: ObservationCorrectionKind?
    let correctsObservationId: String?
    let isCorrected: Bool
    let observedAt: Date
    let recordedAt: Date
    let photos: [ObservationPhotoTransport]

    var domainValue: GardenObservation {
        GardenObservation(
            id: id,
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: gardenObjectId,
            actorType: actorType,
            createdByProfileId: createdByProfileId,
            noteText: noteText,
            conditionSummary: conditionSummary,
            correctionKind: correctionKind,
            correctsObservationId: correctsObservationId,
            isCorrected: isCorrected,
            observedAt: observedAt,
            recordedAt: recordedAt,
            photos: photos.map(\.domainValue)
        )
    }
}

struct ObservationListResultTransport: Decodable {
    let items: [ObservationTransport]
}

/// `photoMediaIds` defaults to `[]` on the wire when omitted — see
/// `FeatureObservations`'s doc comment on why this client never populates it
/// (no media-upload flow exists yet to produce a `mediaId` from).
struct RecordObservationRequestTransport: Encodable {
    let plantId: String?
    let gardenObjectId: String?
    let noteText: String?
    let conditionSummary: String?
    let observedAt: Date?
    let photoMediaIds: [String]
}

struct CorrectObservationRequestTransport: Encodable {
    let correctionKind: ObservationCorrectionKind
    let noteText: String?
    let conditionSummary: String?
    let photoMediaIds: [String]
}
