import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the Today recommendation operations.
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `TaskGateway` exists.
///
/// Every operation here is ONLINE-ONLY by deliberate decision, not omission:
/// recommendations are not a synced record family (candidates are
/// server-generated; no client replicates them offline), so the feedback
/// commands are not routed through the sync push protocol — see
/// docs/development/deferred-capabilities.md, "Offline Today actions in the
/// sync protocol". The Today surface degrades honestly when offline instead
/// of fabricating a local projection.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Recommendations`.
public protocol RecommendationGateway: Sendable {
    /// The prioritized Today set. The server records FIRST PRESENTATION as a
    /// deliberate side effect of this read (`eligible → presented` on first
    /// inclusion), which is naturally idempotent — repeating the request is
    /// safe, so no idempotency key exists on this GET.
    ///
    /// - Parameter limit: bounded cap on the prioritized selection
    ///   (contract: default 10, maximum 25); `nil` omits the parameter.
    func getTodayRecommendations(gardenId: String, limit: Int?) async throws -> TodayResult

    func completeRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation

    /// `postponedUntil` is the user's optional re-surfacing horizon; `nil`
    /// leaves the horizon to the rule's own recurrence interval.
    func postponeRecommendation(
        gardenId: String,
        recommendationId: String,
        postponedUntil: Date?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation

    func dismissRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation

    /// Appends `irrelevant` feedback WITHOUT a lifecycle transition or
    /// revision bump — legal on a `presented` or already-`rejected`
    /// candidate; the response echoes the unchanged recommendation.
    func markRecommendationIrrelevant(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation

    func convertRecommendationToTask(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertRecommendationToTaskResult
}

/// URLSession-backed implementation of the Today recommendation operations.
public struct URLSessionRecommendationGateway: RecommendationGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func getTodayRecommendations(gardenId: String, limit: Int?) async throws -> TodayResult {
        var path = "gardens/\(gardenId)/today"
        if let limit {
            path += "?limit=\(limit)"
        }

        let result: TodayResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func completeRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try await sendFeedbackCommand(
            "complete",
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: idempotencyKey
        )
    }

    public func postponeRecommendation(
        gardenId: String,
        recommendationId: String,
        postponedUntil: Date?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        let result: RecommendationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/recommendations/\(recommendationId)/postpone",
            body: PostponeRecommendationRequestTransport(postponedUntil: postponedUntil),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func dismissRecommendation(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try await sendFeedbackCommand(
            "dismiss",
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: idempotencyKey
        )
    }

    public func markRecommendationIrrelevant(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        try await sendFeedbackCommand(
            "mark-irrelevant",
            gardenId: gardenId,
            recommendationId: recommendationId,
            expectedRevision: expectedRevision,
            idempotencyKey: idempotencyKey
        )
    }

    public func convertRecommendationToTask(
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertRecommendationToTaskResult {
        let result: ConvertRecommendationToTaskResultTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/recommendations/\(recommendationId)/convert-to-task",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    /// Complete, dismiss, and mark-irrelevant share one bodyless POST shape;
    /// only postpone carries a request body and only convert answers `201`.
    private func sendFeedbackCommand(
        _ action: String,
        gardenId: String,
        recommendationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Recommendation {
        let result: RecommendationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/recommendations/\(recommendationId)/\(action)",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }
}
