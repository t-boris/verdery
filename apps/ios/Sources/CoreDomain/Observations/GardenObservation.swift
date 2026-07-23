import Foundation

/// Source: packages/api-contracts/openapi.yaml, `ObservationActorType`.
public enum ObservationActorType: String, Codable, Equatable, Sendable, CaseIterable {
    case user
    case system
}

/// Whether a correction row amends or supersedes the observation it points to.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationCorrectionKind`.
public enum ObservationCorrectionKind: String, Codable, Equatable, Sendable, CaseIterable {
    case amendment
    case supersede
}

/// One entry of a garden's or a plant's observation history.
///
/// Immutable and append-only — no revision, no update path. A correction is
/// a separate row (`correctionKind`/`correctsObservationId`), never an edit
/// of this one; `isCorrected` is set on the *original* row once a later
/// observation names it, so a timeline can flag a superseded/amended entry
/// without ever mutating it.
///
/// Named `GardenObservation`, not `Observation`: the bare name would collide
/// with the `Observation` framework's own top-level `Observation` — the
/// module every `@Observable` view model in this codebase already imports —
/// which broke every `@Observable` macro expansion anywhere `CoreDomain` was
/// also imported until this was renamed. The same collision risk
/// `CoreDomain.GardenTask`'s doc comment documents for `_Concurrency.Task`;
/// the `Garden`-prefixed naming this codebase already uses for
/// `GardenMapObject`, `GardenGeoreference`, and `GardenTask` happens to
/// sidestep this one too.
///
/// Source: packages/api-contracts/openapi.yaml, `Observation`.
public struct GardenObservation: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let plantId: String?
    public let gardenObjectId: String?
    public let actorType: ObservationActorType
    public let createdByProfileId: String?
    public let noteText: String?
    public let conditionSummary: String?
    public let correctionKind: ObservationCorrectionKind?
    public let correctsObservationId: String?
    public let isCorrected: Bool
    public let observedAt: Date
    public let recordedAt: Date
    public let photos: [ObservationPhoto]

    public init(
        id: String,
        gardenId: String,
        plantId: String?,
        gardenObjectId: String?,
        actorType: ObservationActorType,
        createdByProfileId: String?,
        noteText: String?,
        conditionSummary: String?,
        correctionKind: ObservationCorrectionKind?,
        correctsObservationId: String?,
        isCorrected: Bool,
        observedAt: Date,
        recordedAt: Date,
        photos: [ObservationPhoto]
    ) {
        self.id = id
        self.gardenId = gardenId
        self.plantId = plantId
        self.gardenObjectId = gardenObjectId
        self.actorType = actorType
        self.createdByProfileId = createdByProfileId
        self.noteText = noteText
        self.conditionSummary = conditionSummary
        self.correctionKind = correctionKind
        self.correctsObservationId = correctsObservationId
        self.isCorrected = isCorrected
        self.observedAt = observedAt
        self.recordedAt = recordedAt
        self.photos = photos
    }
}
