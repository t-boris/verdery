import Foundation

/// Three axes (`hardiness`, `matureSpace`, `userPreference`) have no rule
/// producing findings yet, each for a recorded reason — the schema's own
/// description.
///
/// Source: packages/api-contracts/openapi.yaml, `SuitabilityAxis`.
public enum SuitabilityAxis: String, Codable, Equatable, Sendable, CaseIterable {
    case hardiness
    case sunExposure = "sun_exposure"
    case soilPh = "soil_ph"
    case drainage
    case matureSpace = "mature_space"
    case growingContext = "growing_context"
    case structuralConflict = "structural_conflict"
    case regulatoryStatus = "regulatory_status"
    case userPreference = "user_preference"
}

/// Source: packages/api-contracts/openapi.yaml, `SuitabilityFinding.category`.
public enum SuitabilityFindingCategory: String, Codable, Equatable, Sendable, CaseIterable {
    case match
    case caution
    case blocker
    case unknown
    case assumption
}

/// Source: packages/api-contracts/openapi.yaml, `SuitabilityFinding.reason`.
public enum SuitabilityUnknownReason: String, Codable, Equatable, Sendable, CaseIterable {
    case gardenContextMissing = "garden_context_missing"
    case plantFactMissing = "plant_fact_missing"
    case placementMissing = "placement_missing"
}

/// One structured fact a `match`/`caution`/`blocker` finding rests on.
/// `value` is untyped on the wire (`value: {}`) — carried through as
/// ``JSONValue`` rather than re-modeled, the same treatment
/// `RecommendationEvidence.factValue` already gives an identically open
/// contract shape.
///
/// Source: packages/api-contracts/openapi.yaml, `SuitabilityEvidence`.
public struct SuitabilityEvidence: Equatable, Sendable {
    public let factKey: String
    public let value: JSONValue
    public let sourceCitation: String?

    public init(factKey: String, value: JSONValue, sourceCitation: String?) {
        self.factKey = factKey
        self.value = value
        self.sourceCitation = sourceCitation
    }
}

/// One finding on one axis. The contract encodes this as one open object
/// rather than a tagged union, so this client mirrors that shape directly:
/// callers branch on `category` before reading the fields that apply to it —
/// `explanation`/`evidence` for `match`/`caution`/`blocker`, `reason` for
/// `unknown`, `explanation`/`assumedValue` for `assumption`. "Missing
/// context never becomes a positive match": a `.unknown` finding never
/// carries `explanation`/`evidence`.
///
/// Source: packages/api-contracts/openapi.yaml, `SuitabilityFinding`.
public struct SuitabilityFinding: Equatable, Sendable {
    public let category: SuitabilityFindingCategory
    public let axis: SuitabilityAxis
    public let explanation: String?
    public let evidence: [SuitabilityEvidence]
    public let reason: SuitabilityUnknownReason?
    public let assumedValue: JSONValue?

    public init(
        category: SuitabilityFindingCategory,
        axis: SuitabilityAxis,
        explanation: String? = nil,
        evidence: [SuitabilityEvidence] = [],
        reason: SuitabilityUnknownReason? = nil,
        assumedValue: JSONValue? = nil
    ) {
        self.category = category
        self.axis = axis
        self.explanation = explanation
        self.evidence = evidence
        self.reason = reason
        self.assumedValue = assumedValue
    }
}

/// A candidate's latest suitability read against a garden's recorded
/// context — always the full, current set of findings, one assessment per
/// `RecalculateCandidateSuitability` call. Append-only on the server; this
/// client only ever reads the latest one.
///
/// Source: packages/api-contracts/openapi.yaml, `SuitabilityAssessment`.
public struct SuitabilityAssessment: Equatable, Sendable {
    public let candidateId: String
    public let findings: [SuitabilityFinding]

    public init(candidateId: String, findings: [SuitabilityFinding]) {
        self.candidateId = candidateId
        self.findings = findings
    }
}
