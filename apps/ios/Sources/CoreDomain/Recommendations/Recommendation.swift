import Foundation

/// Section 6's candidate lifecycle. Responses only ever carry `presented`
/// (Today items are marked presented on first inclusion) or the state a
/// command produced (`completed`, `postponed`, `rejected`); the full
/// vocabulary is declared so this client can render any candidate a future
/// surface exposes — the contract's own reasoning.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationState`.
public enum RecommendationState: String, Codable, Equatable, Sendable, CaseIterable {
    case generated
    case eligible
    case presented
    case completed
    case postponed
    case rejected
    case expired
    case superseded
}

/// Section 13's tiers, minus `restricted`: a restricted-tier candidate is
/// physically impossible server-side (database CHECK + engine type), so this
/// client does not pretend one could appear — the contract's own posture.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationSafetyTier`.
public enum RecommendationSafetyTier: String, Codable, Equatable, Sendable, CaseIterable {
    case ordinaryCare = "ordinary_care"
    case elevatedRisk = "elevated_risk"
}

/// The command-response summary of one recommendation candidate.
///
/// `explanation` is the deterministic reason rendered and stored at
/// generation time — never re-rendered against current facts. `revision`
/// feeds the next command's `If-Match`. Target kind and urgency deliberately
/// reuse the task vocabularies (`TaskTargetKind`, `TaskUrgency`): the
/// underlying columns share one glossary by design — a recommendation a user
/// acts on may become a suggested task — so this client shares the enums
/// rather than translating between identical ones, exactly as the contract
/// shares the schemas.
///
/// Source: packages/api-contracts/openapi.yaml, `Recommendation`.
public struct Recommendation: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let ruleKey: String
    public let ruleVersion: Int
    public let careCategory: String
    public let safetyTier: RecommendationSafetyTier
    public let state: RecommendationState
    public let urgency: TaskUrgency
    public let targetKind: TaskTargetKind
    public let targetGardenAreaMapObjectId: String?
    public let targetPlantId: String?
    public let windowStart: Date?
    public let windowEnd: Date?
    public let explanation: String
    /// The prior candidate this one replaced or re-surfaced, when any — the
    /// walkable supersession/re-surfacing chain.
    public let supersedesCandidateId: String?
    public let presentedAt: Date?
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        ruleKey: String,
        ruleVersion: Int,
        careCategory: String,
        safetyTier: RecommendationSafetyTier,
        state: RecommendationState,
        urgency: TaskUrgency,
        targetKind: TaskTargetKind,
        targetGardenAreaMapObjectId: String?,
        targetPlantId: String?,
        windowStart: Date?,
        windowEnd: Date?,
        explanation: String,
        supersedesCandidateId: String?,
        presentedAt: Date?,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.ruleKey = ruleKey
        self.ruleVersion = ruleVersion
        self.careCategory = careCategory
        self.safetyTier = safetyTier
        self.state = state
        self.urgency = urgency
        self.targetKind = targetKind
        self.targetGardenAreaMapObjectId = targetGardenAreaMapObjectId
        self.targetPlantId = targetPlantId
        self.windowStart = windowStart
        self.windowEnd = windowEnd
        self.explanation = explanation
        self.supersedesCandidateId = supersedesCandidateId
        self.presentedAt = presentedAt
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
