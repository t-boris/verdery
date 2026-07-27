import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the garden context facts operations (P9D-UX-01).
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `RecommendationGateway` exists.
///
/// ONLINE-ONLY, the same posture `SeasonalPlanGateway`'s own doc comment
/// documents: a context fact is a small, occasionally-edited, server-owned
/// upsert, not a synced record family a client replicates offline, so this
/// gateway is not routed through the sync push/pull protocol either.
///
/// `recordGardenContextFact` deliberately takes neither `Idempotency-Key`
/// nor `If-Match` — the endpoint's own contract description: "Idempotent BY
/// DESIGN... a last-writer-wins upsert on a single natural key
/// `(gardenId, contextKind)`, where a retry or concurrent duplicate
/// submitting the same body converges on identical stored state." This is a
/// deliberate divergence from every other mutation in this file's sibling
/// gateways (`RecommendationGateway`'s `revisionHeaders(expectedRevision:
/// idempotencyKey:)`, `GardenGateway`'s `If-Match` on rename/archive) — do
/// not add either header here.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `GardenContext`.
public protocol GardenContextGateway: Sendable {
    /// Every context fact currently recorded for this garden — may omit any
    /// `GardenContextKind` never yet declared or reviewed.
    func listGardenContextFacts(gardenId: String) async throws -> GardenContextFactListResult

    /// Creates the fact at `contextKind` for this garden, or updates it in
    /// place if one is already recorded.
    func recordGardenContextFact(
        gardenId: String,
        contextKind: GardenContextKind,
        value: String,
        source: GardenContextSource,
        reviewedBy: String?,
        reviewedOn: String?
    ) async throws -> GardenContextFact
}

/// URLSession-backed implementation of the garden context facts operations.
public struct URLSessionGardenContextGateway: GardenContextGateway {
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

    public func listGardenContextFacts(gardenId: String) async throws -> GardenContextFactListResult {
        let result: GardenContextFactListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/context",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func recordGardenContextFact(
        gardenId: String,
        contextKind: GardenContextKind,
        value: String,
        source: GardenContextSource,
        reviewedBy: String?,
        reviewedOn: String?
    ) async throws -> GardenContextFact {
        // No `headers:` argument — see this protocol's own doc comment for
        // why neither `Idempotency-Key` nor `If-Match` belongs on this call.
        let result: GardenContextFactTransport = try await transport.send(
            method: "PUT",
            operationPath: "gardens/\(gardenId)/context/\(contextKind.rawValue)",
            body: RecordGardenContextFactRequestTransport(
                value: value,
                source: source,
                reviewedBy: reviewedBy,
                reviewedOn: reviewedOn
            ),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }
}
