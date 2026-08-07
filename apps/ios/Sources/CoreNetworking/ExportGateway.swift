import CoreDomain
import CoreObservability
import Foundation

/// Taking a copy of your own data.
///
/// `implementation-plan.md` section 26.1 lists export as **Required** on both
/// surfaces, and neither client had it. It is also the honest companion to
/// account deletion: "delete everything" is a far easier decision to make with
/// "download everything" beside it.
public protocol ExportGateway: Sendable {
    /// One active export per requester: while a previous one is `requested` or
    /// `running`, a new one is refused with `export.active_export_exists`. The
    /// durable request row is the rate limit, because generating a package is
    /// expensive.
    func requestExport(
        scope: ExportScope,
        gardenId: String?,
        includeMedia: Bool,
        idempotencyKey: String
    ) async throws -> ExportRequest

    func getExport(exportRequestId: String) async throws -> ExportRequest
    /// A short-lived signed link, never a permanent one.
    func getExportDownload(exportRequestId: String) async throws -> MediaAccess
}

struct CreateExportRequestTransport: Encodable {
    let scope: String
    let gardenId: String?
    let includeMedia: Bool
}

struct ExportRequestTransport: Decodable {
    let id: String
    let scope: String
    let gardenId: String?
    let includeMedia: Bool
    let state: String
    let boundaryAt: Date?
    let expiresAt: Date?
    let completedAt: Date?
    let failureCode: String?
    let createdAt: Date

    /// An unrecognised state decodes as `failed` rather than throwing: a
    /// client that refuses to render an export it half-understands leaves
    /// somebody staring at a spinner for a package that will never come.
    var domainValue: ExportRequest {
        ExportRequest(
            id: id,
            scope: ExportScope(rawValue: scope) ?? .account,
            gardenId: gardenId,
            includeMedia: includeMedia,
            state: ExportRequestState(rawValue: state) ?? .failed,
            boundaryAt: boundaryAt,
            expiresAt: expiresAt,
            completedAt: completedAt,
            failureCode: failureCode,
            createdAt: createdAt
        )
    }
}

public struct URLSessionExportGateway: ExportGateway {
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

    public func requestExport(
        scope: ExportScope,
        gardenId: String?,
        includeMedia: Bool,
        idempotencyKey: String
    ) async throws -> ExportRequest {
        let response: ExportRequestTransport = try await transport.send(
            method: "POST",
            operationPath: "exports",
            body: CreateExportRequestTransport(
                scope: scope.rawValue,
                // Required exactly when the scope is `garden`, forbidden for
                // `account` — so it is omitted rather than sent as null.
                gardenId: scope == .garden ? gardenId : nil,
                includeMedia: includeMedia
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200, 201]
        )
        return response.domainValue
    }

    public func getExport(exportRequestId: String) async throws -> ExportRequest {
        let response: ExportRequestTransport = try await transport.get(
            operationPath: "exports/\(exportRequestId)",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func getExportDownload(exportRequestId: String) async throws -> MediaAccess {
        let response: MediaAccessTransport = try await transport.get(
            operationPath: "exports/\(exportRequestId)/download",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }
}
