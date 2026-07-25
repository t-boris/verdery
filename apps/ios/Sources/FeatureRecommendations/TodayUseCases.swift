import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for the Today recommendation surface (P7-IOS-01).
///
/// Every one of these is ONLINE, gateway-backed — a deliberate, documented
/// posture, not a gap, and the same one the calibration flow established
/// (`FeatureMap.SubmitMapCommand`'s `upsertCalibration` caller):
/// recommendations are not a synced record family, candidates are generated
/// exclusively by the server-side rule engine, and their feedback commands
/// are deliberately not part of the sync push protocol — see
/// docs/development/deferred-capabilities.md, "Offline Today actions in the
/// sync protocol". A local projection of a lifecycle the server alone
/// decides (first presentation is recorded by the READ; expiry and
/// supersession sweeps run server-side) would fabricate states this client
/// cannot know, so offline the Today screen says plainly that it needs a
/// connection instead.
///
/// The command use cases generate the idempotency key here — the same
/// responsibility split `SubmitMapCommand` uses: the gateway shapes the
/// request, the use case supplies what varies per attempt.
///
/// Source: implementation-plan.md work package P7-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Recommendations`.
public struct LoadToday: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    /// The GET carries no idempotency key: the server's first-presentation
    /// mark is naturally idempotent, so the read stays safely retryable —
    /// the contract's own description.
    public func callAsFunction(gardenId: String, limit: Int? = nil) async throws -> TodayResult {
        try await gateway.getTodayRecommendations(gardenId: gardenId, limit: limit)
    }
}

public struct CompleteRecommendation: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, recommendationId: String, expectedRevision: Int) async throws -> Recommendation {
        try await gateway.completeRecommendation(
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct PostponeRecommendation: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    /// `postponedUntil` is the user's optional re-surfacing horizon —
    /// `nil` leaves re-surfacing to the rule's own recurrence interval, no
    /// horizon invented (the contract's own posture).
    public func callAsFunction(
        gardenId: String,
        recommendationId: String,
        postponedUntil: Date?,
        expectedRevision: Int
    ) async throws -> Recommendation {
        try await gateway.postponeRecommendation(
            gardenId: gardenId,
            recommendationId: recommendationId,
            postponedUntil: postponedUntil,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct DismissRecommendation: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, recommendationId: String, expectedRevision: Int) async throws -> Recommendation {
        try await gateway.dismissRecommendation(
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Appends the explicit quality signal WITHOUT a lifecycle transition — the
/// candidate stays visible (`presented`) or stays `rejected`; the server
/// echoes it unchanged.
public struct MarkRecommendationIrrelevant: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, recommendationId: String, expectedRevision: Int) async throws -> Recommendation {
        try await gateway.markRecommendationIrrelevant(
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Converts the candidate into a `source: 'suggested'` task in one server
/// transaction. The created task is a normal synced task record — it reaches
/// this device's offline task list through the existing sync pull, and its
/// presence in the garden's task list is this phase's outcome-history
/// linkage (no recommendation-history read endpoint exists yet).
public struct ConvertRecommendationToTask: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int
    ) async throws -> ConvertRecommendationToTaskResult {
        try await gateway.convertRecommendationToTask(
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}
