import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the canonical map operations: read the whole
/// document, submit one command.
///
/// A single `submitCommand` rather than one method per command type mirrors
/// the server's own single revision-aware endpoint (`POST
/// .../map/commands`) — see that operation's description in
/// `packages/api-contracts/openapi.yaml`. `FeatureMap`'s use cases and view
/// model depend on this protocol, never on `URLSession`, so they are testable
/// without a network — the same reason `GardenGateway` exists.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Map`.
public protocol MapGateway: Sendable {
    func getMap(gardenId: String) async throws -> GardenMapDocument
    func submitCommand(
        gardenId: String,
        command: MapCommandPayload,
        idempotencyKey: String
    ) async throws -> MapCommandResult
}

/// URLSession-backed implementation of the map operations.
public struct URLSessionMapGateway: MapGateway {
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

    /// Fetches the whole garden, unbounded.
    ///
    /// The contract also accepts a `minX`/`minY`/`maxX`/`maxY` viewport for
    /// large gardens (see the operation's description); this first pass
    /// always fetches everything, appropriate for the small and ordinary
    /// gardens this release targets. TODO(P3-IOS-01): pass the current
    /// viewport once a garden large enough to need it exists to test against.
    public func getMap(gardenId: String) async throws -> GardenMapDocument {
        let result: GardenMapDocumentTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/map",
            acceptedStatusCodes: [200]
        )

        return result.domainValue
    }

    /// Submits one command and returns the object(s) it affected at their new revision.
    ///
    /// `commandId` (the command's own identity, carried in the body) is
    /// generated here, independently of the caller-supplied `idempotencyKey`
    /// (carried in the `Idempotency-Key` header): the two protect different
    /// things — the header lets a retried request of the *same* command be
    /// recognized as a duplicate, the body field is the command's identity in
    /// provenance and audit history — so this gateway never conflates them by
    /// reusing one value for both, the same way a caller must supply its own
    /// distinct `idempotencyKey` per attempt.
    public func submitCommand(
        gardenId: String,
        command: MapCommandPayload,
        idempotencyKey: String
    ) async throws -> MapCommandResult {
        let body = MapCommandRequestTransport(
            commandId: UUIDv7.generate(),
            clientTimestamp: ISO8601DateFormatter.withFractionalSeconds.string(from: Date()),
            payload: command
        )

        let result: MapCommandResultTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/map/commands",
            body: body,
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return result.domainValue
    }
}
