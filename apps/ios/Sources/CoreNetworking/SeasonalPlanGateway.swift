import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the seasonal plan read (P9D-UX-01).
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `RecommendationGateway` exists.
///
/// ONLINE-ONLY by deliberate decision, not omission — the identical posture
/// `RecommendationGateway`'s own doc comment documents for the Today
/// surface, which applies here unchanged: a garden's seasonal plan is not a
/// synced record family (the reviewed timing facts and rotation status are
/// entirely server-derived; no client replicates them offline), so this
/// gateway is not routed through the sync push/pull protocol. The Seasonal
/// plan surface degrades honestly when offline instead of fabricating a
/// local projection.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
public protocol SeasonalPlanGateway: Sendable {
    /// Every active plant's full reviewed seasonal timing fact (all
    /// configured windows, not just the currently-open one) for the
    /// garden's own hemisphere, plus the continuous bed-rotation status per
    /// placed plant with a known family.
    func getSeasonalPlan(gardenId: String) async throws -> SeasonalPlanResult
}

/// URLSession-backed implementation of the seasonal plan read.
public struct URLSessionSeasonalPlanGateway: SeasonalPlanGateway {
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

    public func getSeasonalPlan(gardenId: String) async throws -> SeasonalPlanResult {
        let result: SeasonalPlanResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/seasonal-plan",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }
}
