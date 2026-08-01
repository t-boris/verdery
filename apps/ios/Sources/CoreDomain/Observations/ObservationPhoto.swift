import Foundation

/// Source: packages/api-contracts/openapi.yaml, `ImageAnalysisKind`.
public enum ImageAnalysisKind: String, Codable, Equatable, Sendable, CaseIterable {
    case stress
    case disease
    case pest
    case other
}

/// The design doc's own "health suggestion" (§9) — an unconfirmed automated
/// observation, never a diagnosis: `requiresConfirmation` is always `true`,
/// and this type structurally has no toxicity/edibility/pesticide/treatment/
/// regulatory field — the model cannot directly populate one because no such
/// field exists here or anywhere this is produced. The UI must surface this
/// plainly, never as a confirmed diagnosis — see `ObservationsTimelineView`.
///
/// `modelName == nil` means no provider was ever reached (disabled, quota
/// exhausted, timed out); `evidenceSummary`/`alternativeExplanations`/
/// `requestedViewPurposes` are then a fixed placeholder shape (empty/empty/
/// empty), not a genuine analysis. `dispositionSetAt`/
/// `dispositionSetByProfileId` are `nil` exactly when `disposition ==
/// .unresolved`, set together otherwise (`SetHealthSuggestionDisposition`).
///
/// Source: packages/api-contracts/openapi.yaml, `ImageAnalysisResult`;
/// architecture/plant-intelligence-and-visual-journal.md, section
/// "9. Health Suggestions"; implementation-plan.md work package P11-HEALTH-01.
public struct ImageAnalysisResult: Equatable, Sendable, Identifiable {
    public let id: String
    public let analysisKind: ImageAnalysisKind
    public let suggestedLabel: String
    public let confidenceScore: Double
    public let requiresConfirmation: Bool
    public let requestedAdditionalEvidence: Bool
    public let evidenceSummary: String
    public let alternativeExplanations: [String]
    public let safetyClass: HealthSuggestionSafetyClass
    public let requestedViewPurposes: [ObservationPhotoPurpose]
    public let modelName: String?
    public let promptVersion: Int?
    public let disposition: HealthSuggestionDisposition
    public let dispositionSetAt: Date?
    public let dispositionSetByProfileId: String?
    public let createdAt: Date

    public init(
        id: String,
        analysisKind: ImageAnalysisKind,
        suggestedLabel: String,
        confidenceScore: Double,
        requiresConfirmation: Bool,
        requestedAdditionalEvidence: Bool,
        evidenceSummary: String,
        alternativeExplanations: [String],
        safetyClass: HealthSuggestionSafetyClass,
        requestedViewPurposes: [ObservationPhotoPurpose],
        modelName: String?,
        promptVersion: Int?,
        disposition: HealthSuggestionDisposition,
        dispositionSetAt: Date?,
        dispositionSetByProfileId: String?,
        createdAt: Date
    ) {
        self.id = id
        self.analysisKind = analysisKind
        self.suggestedLabel = suggestedLabel
        self.confidenceScore = confidenceScore
        self.requiresConfirmation = requiresConfirmation
        self.requestedAdditionalEvidence = requestedAdditionalEvidence
        self.evidenceSummary = evidenceSummary
        self.alternativeExplanations = alternativeExplanations
        self.safetyClass = safetyClass
        self.requestedViewPurposes = requestedViewPurposes
        self.modelName = modelName
        self.promptVersion = promptVersion
        self.disposition = disposition
        self.dispositionSetAt = dispositionSetAt
        self.dispositionSetByProfileId = dispositionSetByProfileId
        self.createdAt = createdAt
    }
}

/// A photo attached to an observation, together with any image-analysis
/// passes run against it (P11-HEALTH-01 — see `ImageAnalysisResult`'s own
/// doc comment for the real, non-stubbed shape those passes now produce).
///
/// This type does not yet model `purpose` (the Visual Plant Journal capture
/// label, P11-MEDIA-01) — a real, separate follow-up: journal photo/
/// measurement capture UI is a bigger lift this pass does not build, the
/// same scope this codebase's web client also deferred.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationPhoto`.
public struct ObservationPhoto: Equatable, Sendable, Identifiable {
    public let id: String
    public let mediaId: String
    public let createdAt: Date
    public let analysisResults: [ImageAnalysisResult]

    public init(id: String, mediaId: String, createdAt: Date, analysisResults: [ImageAnalysisResult]) {
        self.id = id
        self.mediaId = mediaId
        self.createdAt = createdAt
        self.analysisResults = analysisResults
    }
}
