import CoreObservability
import Foundation

/// Web session exchange, kept in `CoreNetworking` for the rare case a native
/// build wants it (Apple's own account-linking flows can go through the web
/// session path), even though the native flow ordinarily authenticates every
/// request with a bearer ID token directly and never establishes a session
/// cookie.
///
/// Source: architecture/identity-and-authorization.md, sections
/// "4. Native Authentication Flow", "5. Web Session Flow".
public protocol SessionGateway: Sendable {
    func createSession(idToken: String) async throws
    func endSession() async throws
}

struct SessionLoginRequestTransport: Encodable {
    let idToken: String
}

public struct URLSessionSessionGateway: SessionGateway {
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

    public func createSession(idToken: String) async throws {
        try await transport.sendNoContent(
            method: "POST",
            operationPath: "auth/session",
            body: SessionLoginRequestTransport(idToken: idToken)
        )
    }

    public func endSession() async throws {
        try await transport.sendNoContent(method: "DELETE", operationPath: "auth/session")
    }
}
