import CoreDomain
import Foundation

/// Wire shapes of the recommendation operations. See `PlantTransport.swift`'s
/// doc comment for why the enums code by straight synthesis.
///
/// `TodayRecommendationTransport` mirrors the contract's deliberately FLAT
/// `TodayRecommendation` schema (flat only because two
/// `additionalProperties: false` schemas cannot compose via `allOf` — the
/// contract's own note), then maps into `CoreDomain.TodayRecommendation`'s
/// composition — see that type's doc comment.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Recommendations`.
struct RecommendationTransport: Decodable {
    let id: String
    let gardenId: String
    let ruleKey: String
    let ruleVersion: Int
    let careCategory: String
    let safetyTier: RecommendationSafetyTier
    let state: RecommendationState
    let urgency: TaskUrgency
    let targetKind: TaskTargetKind
    let targetGardenAreaMapObjectId: String?
    let targetPlantId: String?
    let windowStart: Date?
    let windowEnd: Date?
    let explanation: String
    let supersedesCandidateId: String?
    let presentedAt: Date?
    let revision: Int
    let createdAt: Date
    let updatedAt: Date

    var domainValue: Recommendation {
        Recommendation(
            id: id,
            gardenId: gardenId,
            ruleKey: ruleKey,
            ruleVersion: ruleVersion,
            careCategory: careCategory,
            safetyTier: safetyTier,
            state: state,
            urgency: urgency,
            targetKind: targetKind,
            targetGardenAreaMapObjectId: targetGardenAreaMapObjectId,
            targetPlantId: targetPlantId,
            windowStart: windowStart,
            windowEnd: windowEnd,
            explanation: explanation,
            supersedesCandidateId: supersedesCandidateId,
            presentedAt: presentedAt,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

struct RecommendationPriorityFactorTransport: Decodable {
    let kind: RecommendationPriorityFactorKind
    let contribution: Int
    let basis: [String: JSONValue]

    var domainValue: RecommendationPriorityFactor {
        RecommendationPriorityFactor(kind: kind, contribution: contribution, basis: basis)
    }
}

struct RecommendationEvidenceTransport: Decodable {
    let id: String
    let kind: RecommendationEvidenceKind
    let sourceObservationId: String?
    let sourceTaskId: String?
    let sourcePlantId: String?
    let sourceWeatherRecordId: String?
    let factKey: String
    /// `factValue` is a required wire member whose VALUE may be JSON `null`
    /// (`factValue: {}` — any JSON). A synthesized `JSONValue` property
    /// would be non-optional and `decode` would still surface `null` as
    /// `.null` through `JSONValue`'s own single-value decoder, so plain
    /// synthesis works; `?? .null` below only normalizes the impossible
    /// absent-member case defensively.
    let factValue: JSONValue?

    var domainValue: RecommendationEvidence {
        RecommendationEvidence(
            id: id,
            kind: kind,
            sourceObservationId: sourceObservationId,
            sourceTaskId: sourceTaskId,
            sourcePlantId: sourcePlantId,
            sourceWeatherRecordId: sourceWeatherRecordId,
            factKey: factKey,
            factValue: factValue ?? .null
        )
    }
}

/// The contract's flat Today item: every `Recommendation` field plus the
/// view-only members. Decoded flat, exactly as the wire declares it, then
/// recomposed into the domain's `Recommendation`-plus-extras shape.
struct TodayRecommendationTransport: Decodable {
    let id: String
    let gardenId: String
    let ruleKey: String
    let ruleVersion: Int
    let careCategory: String
    let safetyTier: RecommendationSafetyTier
    let state: RecommendationState
    let urgency: TaskUrgency
    let targetKind: TaskTargetKind
    let targetGardenAreaMapObjectId: String?
    let targetPlantId: String?
    let windowStart: Date?
    let windowEnd: Date?
    let explanation: String
    let supersedesCandidateId: String?
    let presentedAt: Date?
    let revision: Int
    let createdAt: Date
    let updatedAt: Date
    let actionTitle: String
    let priorityScore: Int
    let priorityFactors: [RecommendationPriorityFactorTransport]
    let evidence: [RecommendationEvidenceTransport]
    let targetDisplayName: String?

    var domainValue: TodayRecommendation {
        TodayRecommendation(
            recommendation: Recommendation(
                id: id,
                gardenId: gardenId,
                ruleKey: ruleKey,
                ruleVersion: ruleVersion,
                careCategory: careCategory,
                safetyTier: safetyTier,
                state: state,
                urgency: urgency,
                targetKind: targetKind,
                targetGardenAreaMapObjectId: targetGardenAreaMapObjectId,
                targetPlantId: targetPlantId,
                windowStart: windowStart,
                windowEnd: windowEnd,
                explanation: explanation,
                supersedesCandidateId: supersedesCandidateId,
                presentedAt: presentedAt,
                revision: revision,
                createdAt: createdAt,
                updatedAt: updatedAt
            ),
            actionTitle: actionTitle,
            priorityScore: priorityScore,
            priorityFactors: priorityFactors.map(\.domainValue),
            evidence: evidence.map(\.domainValue),
            targetDisplayName: targetDisplayName
        )
    }
}

struct TodayResultTransport: Decodable {
    let gardenId: String
    let generatedAt: Date
    let items: [TodayRecommendationTransport]

    var domainValue: TodayResult {
        TodayResult(gardenId: gardenId, generatedAt: generatedAt, items: items.map(\.domainValue))
    }
}

/// `postponedUntil` is the user's optional re-surfacing horizon. Absent and
/// `null` mean the same thing server-side ("No default is applied when
/// absent or `null`" — the contract's own description), so `nil` simply
/// omits the member rather than distinguishing the two.
struct PostponeRecommendationRequestTransport: Encodable {
    let postponedUntil: Date?

    private enum CodingKeys: String, CodingKey { case postponedUntil }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(postponedUntil, forKey: .postponedUntil)
    }
}

struct ConvertRecommendationToTaskResultTransport: Decodable {
    let recommendation: RecommendationTransport
    let task: GardenTaskTransport

    var domainValue: ConvertRecommendationToTaskResult {
        ConvertRecommendationToTaskResult(recommendation: recommendation.domainValue, task: task.domainValue)
    }
}
