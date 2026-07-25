import Foundation

/// One Today item: the candidate summary plus everything the Today view
/// alone renders — FR-24's proposed action, the server-re-derived priority
/// score with its stored factors, the structured evidence, and the target's
/// current display name.
///
/// The contract declares `TodayRecommendation` flat rather than via `allOf`
/// only because both wire schemas forbid additional properties — its own
/// description says "every `Recommendation` field ... plus everything the
/// view alone renders". Swift has no such constraint, so this type composes
/// ``Recommendation`` instead of duplicating its nineteen fields; the
/// transport layer decodes the flat wire shape into this composition.
///
/// Source: packages/api-contracts/openapi.yaml, `TodayRecommendation`.
public struct TodayRecommendation: Equatable, Sendable, Identifiable {
    public let recommendation: Recommendation
    /// The rule version's suggested action — also the title a conversion
    /// gives the task.
    public let actionTitle: String
    public let priorityScore: Int
    public let priorityFactors: [RecommendationPriorityFactor]
    public let evidence: [RecommendationEvidence]
    /// The plant's current display name for plant targets; `nil` for garden
    /// targets (the client knows its garden) and for garden-area targets,
    /// which no launch rule produces.
    public let targetDisplayName: String?

    public var id: String { recommendation.id }

    public init(
        recommendation: Recommendation,
        actionTitle: String,
        priorityScore: Int,
        priorityFactors: [RecommendationPriorityFactor],
        evidence: [RecommendationEvidence],
        targetDisplayName: String?
    ) {
        self.recommendation = recommendation
        self.actionTitle = actionTitle
        self.priorityScore = priorityScore
        self.priorityFactors = priorityFactors
        self.evidence = evidence
        self.targetDisplayName = targetDisplayName
    }
}

/// The prioritized Today set for one garden, exactly as one
/// `getTodayRecommendations` response returned it. `generatedAt` is the
/// server's own response timestamp — what an honest staleness label is
/// measured against.
///
/// Source: packages/api-contracts/openapi.yaml, `TodayResult`.
public struct TodayResult: Equatable, Sendable {
    public let gardenId: String
    public let generatedAt: Date
    public let items: [TodayRecommendation]

    public init(gardenId: String, generatedAt: Date, items: [TodayRecommendation]) {
        self.gardenId = gardenId
        self.generatedAt = generatedAt
        self.items = items
    }
}

/// The result of converting a recommendation into a task: the now-`completed`
/// candidate and the created `source: 'suggested'` task — the task's
/// existence in the garden's task list is the phase's outcome-history
/// linkage.
///
/// Source: packages/api-contracts/openapi.yaml, `ConvertRecommendationToTaskResult`.
public struct ConvertRecommendationToTaskResult: Equatable, Sendable {
    public let recommendation: Recommendation
    public let task: GardenTask

    public init(recommendation: Recommendation, task: GardenTask) {
        self.recommendation = recommendation
        self.task = task
    }
}
