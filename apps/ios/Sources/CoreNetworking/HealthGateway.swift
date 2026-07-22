import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the health operations.
///
/// Features depend on this protocol, never on URLSession or on a generated
/// client, so a feature test needs no network and no server.
///
/// Source: architecture/ios-application-design.md, section "9. Networking".
public protocol HealthGateway: Sendable {
    /// Reports whether the process is running.
    func liveness() async throws -> ServiceLiveness

    /// Reports whether the service can serve traffic, including dependencies.
    ///
    /// A service that is not ready answers `503` with the same body, so an
    /// unready service is a value rather than a thrown error.
    func readiness() async throws -> ServiceHealth
}

/// URLSession-backed implementation of the health operations.
///
/// This is the whole hand-written surface for Phase 1. Broader operations are
/// generated from the OpenAPI document later and remain behind a gateway of
/// this shape.
public struct URLSessionHealthGateway: HealthGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            log: log
        )
    }

    public func liveness() async throws -> ServiceLiveness {
        let result: LivenessResultTransport = try await transport.get(
            operationPath: "health/live",
            acceptedStatusCodes: [200]
        )

        return result.domainValue
    }

    public func readiness() async throws -> ServiceHealth {
        // 503 is a declared outcome of this operation, not a failure: the body
        // still carries the dependency detail the user is shown.
        let result: ReadinessResultTransport = try await transport.get(
            operationPath: "health/ready",
            acceptedStatusCodes: [200, 503]
        )

        return result.domainValue
    }
}
