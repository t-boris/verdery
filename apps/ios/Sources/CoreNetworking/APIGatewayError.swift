import Foundation

/// Every way a gateway call can fail, classified the way the architecture
/// classifies errors so that a caller can choose a safe next action without
/// inspecting an HTTP status code.
///
/// Source: architecture/ios-application-design.md, section "16. Error Handling".
public enum APIGatewayError: Error, Equatable, Sendable {
    /// The service answered with the contract's error envelope.
    case service(APIErrorBody, statusCode: Int)

    /// Connectivity failed before an answer arrived.
    case transport(code: URLError.Code, correlationId: String)

    /// A response arrived but did not match the contract.
    ///
    /// This is a defect on one side of the contract, never something the user
    /// can correct, so it is deliberately distinct from ``service``.
    case undecodableResponse(statusCode: Int, correlationId: String)

    /// A status code the operation does not declare.
    case unexpectedStatus(Int, correlationId: String)

    /// Whether repeating the identical request may succeed later.
    ///
    /// The service is authoritative for its own errors; connectivity failures
    /// are retryable by definition and contract violations never are.
    public var isRetryable: Bool {
        switch self {
        case let .service(body, _): body.retryable
        case .transport: true
        case .undecodableResponse: false
        case .unexpectedStatus: false
        }
    }

    /// Identifier for correlating this failure with server telemetry.
    public var correlationId: String {
        switch self {
        case let .service(body, _): body.correlationId
        case let .transport(_, correlationId): correlationId
        case let .undecodableResponse(_, correlationId): correlationId
        case let .unexpectedStatus(_, correlationId): correlationId
        }
    }
}
