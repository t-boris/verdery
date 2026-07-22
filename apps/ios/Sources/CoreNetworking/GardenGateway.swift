import CoreDomain
import CoreObservability
import Foundation

/// The application's view of one page of gardens.
public struct GardenPage: Equatable, Sendable {
    public let items: [Garden]
    /// Opaque. `nil` means no further page exists.
    public let nextCursor: String?

    public init(items: [Garden], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// The application's view of the garden lifecycle operations.
///
/// Features depend on this protocol, never on URLSession or on a generated
/// client, so a feature test needs no network and no server.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Gardens`.
public protocol GardenGateway: Sendable {
    func list(cursor: String?) async throws -> GardenPage
    func create(name: String, idempotencyKey: String) async throws -> Garden
    func get(gardenId: String) async throws -> Garden
    func rename(
        gardenId: String,
        name: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Garden
    func archive(gardenId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden
    func requestDeletion(
        gardenId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Garden
}

/// URLSession-backed implementation of the garden operations.
public struct URLSessionGardenGateway: GardenGateway {
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

    public func list(cursor: String?) async throws -> GardenPage {
        var path = "gardens"
        if let cursor, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?cursor=\(encoded)"
        }

        let result: GardenListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )

        return try GardenPage(items: result.items.map(domainGarden), nextCursor: result.nextCursor)
    }

    public func create(name: String, idempotencyKey: String) async throws -> Garden {
        let result: GardenTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens",
            body: CreateGardenRequestTransport(name: name),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )

        return try domainGarden(result)
    }

    public func get(gardenId: String) async throws -> Garden {
        let result: GardenTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)",
            acceptedStatusCodes: [200]
        )

        return try domainGarden(result)
    }

    public func rename(
        gardenId: String,
        name: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Garden {
        let result: GardenTransport = try await transport.send(
            method: "PATCH",
            operationPath: "gardens/\(gardenId)",
            body: RenameGardenRequestTransport(name: name),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )

        return try domainGarden(result)
    }

    public func archive(
        gardenId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Garden {
        let result: GardenTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/archive",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )

        return try domainGarden(result)
    }

    public func requestDeletion(
        gardenId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Garden {
        let result: GardenTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/delete-request",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )

        return try domainGarden(result)
    }

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }

    private func domainGarden(_ transport: GardenTransport) throws -> Garden {
        guard let garden = transport.domainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return garden
    }
}
