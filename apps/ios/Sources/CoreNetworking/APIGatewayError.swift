import Foundation

/// Every way a gateway call can fail, classified the way the architecture
/// classifies errors so that a caller can choose a safe next action without
/// inspecting an HTTP status code.
///
/// Source: architecture/ios-application-design.md, section "16. Error Handling".
public enum APIGatewayError: Error, Equatable, Sendable {
    /// The service answered with the contract's error envelope.
    ///
    /// `retryAfterSeconds` is the `Retry-After` response header
    /// (`packages/api-contracts/openapi.yaml`, `components.headers.RetryAfter`
    /// — documented today only on `TooManyRequests`/`429`, but read
    /// unconditionally off any rejected status so a future response that
    /// also sends it is honored without this type changing again), `nil`
    /// when the response carried none. Added in P5-IOS-03, Stage 5b, for
    /// architecture/offline-synchronization.md, section "20. Connectivity
    /// and Backoff": "`Retry-After` is honored."
    case service(APIErrorBody, statusCode: Int, retryAfterSeconds: Int?)

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
        case let .service(body, _, _): body.retryable
        case .transport: true
        case .undecodableResponse: false
        case .unexpectedStatus: false
        }
    }

    /// Identifier for correlating this failure with server telemetry.
    public var correlationId: String {
        switch self {
        case let .service(body, _, _): body.correlationId
        case let .transport(_, correlationId): correlationId
        case let .undecodableResponse(_, correlationId): correlationId
        case let .unexpectedStatus(_, correlationId): correlationId
        }
    }

    /// Seconds the server asked the caller to wait before retrying, `nil`
    /// for every error class besides `.service` and for a `.service` failure
    /// whose response carried no `Retry-After` header at all.
    public var retryAfterSeconds: Int? {
        if case let .service(_, _, retryAfterSeconds) = self { return retryAfterSeconds }
        return nil
    }
}
