import Foundation

/// What an observer SAW, never what caused it: `leafSpots` is visible,
/// `blight` would be a diagnosis they are guessing at.
///
/// Deliberately not `ImageAnalysisKind`. That enum is a model's vocabulary for
/// what it proposed; this one is a person's for what they reported, and the two
/// are never merged — see `ObservationSymptom`.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationSymptomKind`.
public enum ObservationSymptomKind: String, Codable, Equatable, Sendable, CaseIterable {
    case leafSpots = "leaf_spots"
    case leafYellowing = "leaf_yellowing"
    case leafCurling = "leaf_curling"
    case wilting
    case holesOrChewing = "holes_or_chewing"
    case mouldOrMildew = "mould_or_mildew"
    case dieback
    case stuntedGrowth = "stunted_growth"
    case unusualGrowth = "unusual_growth"
}

/// Three values rather than a numeric scale: two people would not report the
/// same leaf as the same number out of ten.
public enum ObservationSymptomSeverity: String, Codable, Equatable, Sendable, CaseIterable {
    case mild
    case moderate
    case severe
}

/// A symptom a PERSON reported on an observation (P11-MEDIA-01).
///
/// Never an `ImageAnalysisResult`, which is what a model proposed and what a
/// reviewer decided about it. The two carry different weight in a health
/// review and share no storage, no vocabulary, and no reference; a screen that
/// showed them as one list would present a guess as testimony.
///
/// At most one per kind per observation: seeing the same symptom worse next
/// week is a new observation.
public struct ObservationSymptom: Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: ObservationSymptomKind
    public let severity: ObservationSymptomSeverity
    public let createdAt: Date

    public init(
        id: String,
        kind: ObservationSymptomKind,
        severity: ObservationSymptomSeverity,
        createdAt: Date
    ) {
        self.id = id
        self.kind = kind
        self.severity = severity
        self.createdAt = createdAt
    }
}

/// A symptom being reported, before the server assigns it an id.
public struct ObservationSymptomInput: Equatable, Sendable, Identifiable {
    public var kind: ObservationSymptomKind
    public var severity: ObservationSymptomSeverity

    /// The kind: unique across an observation's symptoms by construction.
    public var id: ObservationSymptomKind { kind }

    public init(kind: ObservationSymptomKind, severity: ObservationSymptomSeverity) {
        self.kind = kind
        self.severity = severity
    }
}
