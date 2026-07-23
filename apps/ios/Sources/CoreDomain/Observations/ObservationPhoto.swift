import Foundation

/// Source: packages/api-contracts/openapi.yaml, `ImageAnalysisKind`.
public enum ImageAnalysisKind: String, Codable, Equatable, Sendable, CaseIterable {
    case stress
    case disease
    case pest
    case other
}

/// A stubbed, honest placeholder: `requiresConfirmation` is always `true` —
/// an automated diagnosis is never presented as a confirmed fact without
/// explicit user confirmation. The UI must surface this plainly, never as a
/// confirmed diagnosis — see `ObservationsTimelineView`.
///
/// Source: packages/api-contracts/openapi.yaml, `ImageAnalysisResult`.
public struct ImageAnalysisResult: Equatable, Sendable, Identifiable {
    public let id: String
    public let analysisKind: ImageAnalysisKind
    public let suggestedLabel: String
    public let confidenceScore: Double
    public let requiresConfirmation: Bool
    public let requestedAdditionalEvidence: Bool
    public let createdAt: Date

    public init(
        id: String,
        analysisKind: ImageAnalysisKind,
        suggestedLabel: String,
        confidenceScore: Double,
        requiresConfirmation: Bool,
        requestedAdditionalEvidence: Bool,
        createdAt: Date
    ) {
        self.id = id
        self.analysisKind = analysisKind
        self.suggestedLabel = suggestedLabel
        self.confidenceScore = confidenceScore
        self.requiresConfirmation = requiresConfirmation
        self.requestedAdditionalEvidence = requestedAdditionalEvidence
        self.createdAt = createdAt
    }
}

/// A photo attached to an observation, together with any stubbed
/// image-analysis passes run against it.
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
