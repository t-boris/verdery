/// Section 7's priority-input list as the closed factor vocabulary.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationPriorityFactorKind`.
public enum RecommendationPriorityFactorKind: String, Codable, Equatable, Sendable, CaseIterable {
    case urgencyWindow = "urgency_window"
    case plantImpact = "plant_impact"
    case confidence
    case weatherOpportunityOrRisk = "weather_opportunity_or_risk"
    case userEffortAndAvailability = "user_effort_and_availability"
    case taskOverlap = "task_overlap"
    case safetyConstraint = "safety_constraint"
    case seasonalConstraint = "seasonal_constraint"
}

/// One stored, explainable priority input: a candidate's score is the
/// clamped-to-[0, 100] sum of these integer contributions — the factors
/// alone reproduce the rank.
///
/// `basis` names the facts the contribution derives from; uncertainty
/// signals such as low confidence or a stale-weather label live here (and in
/// the evidence values). Kept as open ``JSONValue`` fields because the
/// contract declares `basis` with `additionalProperties: true` — this client
/// renders the stored facts as readable text, never re-interprets them.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationPriorityFactor`.
public struct RecommendationPriorityFactor: Equatable, Sendable {
    public let kind: RecommendationPriorityFactorKind
    public let contribution: Int
    public let basis: [String: JSONValue]

    public init(kind: RecommendationPriorityFactorKind, contribution: Int, basis: [String: JSONValue]) {
        self.kind = kind
        self.contribution = contribution
        self.basis = basis
    }
}
