import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the recommendation API — mirrors
/// `FeatureTasksTests/FakeTaskGateway`'s role for this feature's view-model
/// tests. Models the server lifecycle honestly so a test can tell a correct
/// guard from a broken one: revision guards (412), the `presented`-state
/// precondition on the transition commands (409), mark-irrelevant's
/// no-transition/no-revision-bump contract, and conversion's
/// candidate-to-task field carry-over.
final class FakeRecommendationGateway: RecommendationGateway, @unchecked Sendable {
    struct FeedbackEntry: Equatable {
        let recommendationId: String
        let kind: String
        let postponedUntil: Date?
    }

    /// Candidates currently in the Today set (server states
    /// `eligible`/`presented` collapse to one dictionary here — the fake
    /// marks presentation implicitly, exactly as inclusion in a response
    /// does server-side).
    private(set) var todayItems: [String: TodayRecommendation]
    /// Dismissed candidates — still legal targets for mark-irrelevant.
    private(set) var rejectedItems: [String: TodayRecommendation] = [:]
    private(set) var feedback: [FeedbackEntry] = []
    private(set) var createdTasks: [GardenTask] = []
    private(set) var todayRequestCount = 0
    private(set) var lastRequestedLimit: Int?
    private(set) var idempotencyKeys: [String] = []
    /// When set, the next call throws this once instead of answering.
    var nextFailure: APIGatewayError?

    var generatedAt = Date(timeIntervalSince1970: 1_785_800_000)

    init(items: [TodayRecommendation] = []) {
        self.todayItems = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    }

    func getTodayRecommendations(gardenId: String, limit: Int?) async throws -> TodayResult {
        try throwPlannedFailure()
        todayRequestCount += 1
        lastRequestedLimit = limit

        // The server's order: priority score descending, then id.
        let items = todayItems.values.sorted {
            ($0.priorityScore, $1.id) > ($1.priorityScore, $0.id)
        }
        return TodayResult(gardenId: gardenId, generatedAt: generatedAt, items: Array(items))
    }

    func completeRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try throwPlannedFailure()
        idempotencyKeys.append(idempotencyKey)
        let item = try expectPresented(recommendationId, expectedRevision: expectedRevision)
        todayItems[recommendationId] = nil
        feedback.append(FeedbackEntry(recommendationId: recommendationId, kind: "completed", postponedUntil: nil))
        return withState(item.recommendation, .completed)
    }

    func postponeRecommendation(
        gardenId: String,
        recommendationId: String,
        postponedUntil: Date?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try throwPlannedFailure()
        idempotencyKeys.append(idempotencyKey)
        let item = try expectPresented(recommendationId, expectedRevision: expectedRevision)
        todayItems[recommendationId] = nil
        feedback.append(
            FeedbackEntry(recommendationId: recommendationId, kind: "postponed", postponedUntil: postponedUntil))
        return withState(item.recommendation, .postponed)
    }

    func dismissRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try throwPlannedFailure()
        idempotencyKeys.append(idempotencyKey)
        let item = try expectPresented(recommendationId, expectedRevision: expectedRevision)
        todayItems[recommendationId] = nil
        rejectedItems[recommendationId] = item
        feedback.append(FeedbackEntry(recommendationId: recommendationId, kind: "dismissed", postponedUntil: nil))
        return withState(item.recommendation, .rejected)
    }

    func markRecommendationIrrelevant(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try throwPlannedFailure()
        idempotencyKeys.append(idempotencyKey)

        // Legal on a still-visible `presented` candidate or an
        // already-`rejected` one; NO transition and NO revision bump.
        guard let item = todayItems[recommendationId] ?? rejectedItems[recommendationId] else {
            throw Self.serviceError(statusCode: 404, code: "shared.not_found")
        }
        guard item.recommendation.revision == expectedRevision else {
            throw Self.serviceError(statusCode: 412, code: "shared.revision_mismatch")
        }

        feedback.append(FeedbackEntry(recommendationId: recommendationId, kind: "irrelevant", postponedUntil: nil))
        return item.recommendation
    }

    func convertRecommendationToTask(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertRecommendationToTaskResult {
        try throwPlannedFailure()
        idempotencyKeys.append(idempotencyKey)
        let item = try expectPresented(recommendationId, expectedRevision: expectedRevision)
        todayItems[recommendationId] = nil
        feedback.append(FeedbackEntry(recommendationId: recommendationId, kind: "completed", postponedUntil: nil))

        // The conversion's documented carry-over: the rule's action title as
        // the task title, the stored explanation as notes, target, urgency,
        // and window verbatim; `source: 'suggested'`, `status: 'planned'`,
        // no due date invented.
        let recommendation = item.recommendation
        let task = GardenTask(
            id: "task-\(createdTasks.count + 1)",
            gardenId: recommendation.gardenId,
            targetKind: recommendation.targetKind,
            targetGardenAreaMapObjectId: recommendation.targetGardenAreaMapObjectId,
            targetPlantId: recommendation.targetPlantId,
            title: item.actionTitle,
            notes: recommendation.explanation,
            status: .planned,
            dueDate: nil,
            timeWindowStart: recommendation.windowStart,
            timeWindowEnd: recommendation.windowEnd,
            recurrenceRule: nil,
            urgency: recommendation.urgency,
            source: .suggested,
            originObservationId: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: generatedAt,
            updatedAt: generatedAt,
            completedAt: nil
        )
        createdTasks.append(task)
        return ConvertRecommendationToTaskResult(recommendation: withState(recommendation, .completed), task: task)
    }

    private func throwPlannedFailure() throws {
        if let failure = nextFailure {
            nextFailure = nil
            throw failure
        }
    }

    private func expectPresented(_ recommendationId: String, expectedRevision: Int) throws -> TodayRecommendation {
        guard let item = todayItems[recommendationId] else {
            // Not (or no longer) in the presentable set — the transition
            // commands' `presented`-state precondition.
            throw Self.serviceError(statusCode: 409, code: "recommendations.not_presented")
        }
        guard item.recommendation.revision == expectedRevision else {
            throw Self.serviceError(statusCode: 412, code: "shared.revision_mismatch")
        }
        return item
    }

    private func withState(_ recommendation: Recommendation, _ state: RecommendationState) -> Recommendation {
        Recommendation(
            id: recommendation.id,
            gardenId: recommendation.gardenId,
            ruleKey: recommendation.ruleKey,
            ruleVersion: recommendation.ruleVersion,
            careCategory: recommendation.careCategory,
            safetyTier: recommendation.safetyTier,
            state: state,
            urgency: recommendation.urgency,
            targetKind: recommendation.targetKind,
            targetGardenAreaMapObjectId: recommendation.targetGardenAreaMapObjectId,
            targetPlantId: recommendation.targetPlantId,
            windowStart: recommendation.windowStart,
            windowEnd: recommendation.windowEnd,
            explanation: recommendation.explanation,
            supersedesCandidateId: recommendation.supersedesCandidateId,
            presentedAt: recommendation.presentedAt,
            revision: recommendation.revision + 1,
            createdAt: recommendation.createdAt,
            updatedAt: recommendation.updatedAt
        )
    }

    static func serviceError(statusCode: Int, code: String) -> APIGatewayError {
        .service(
            APIErrorBody(code: code, message: code, correlationId: "fake", retryable: false),
            statusCode: statusCode,
            retryAfterSeconds: nil
        )
    }
}
