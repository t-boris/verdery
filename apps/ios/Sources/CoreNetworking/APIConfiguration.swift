import Foundation

/// Everything the API gateway needs that varies between environments.
///
/// Configuration is injected from the composition root rather than read from a
/// global, so a test can point the same gateway at a stub without mutating
/// process state.
///
/// Source: architecture/ios-application-design.md, section "5.4 Infrastructure".
public struct APIConfiguration: Equatable, Sendable {
    /// Origin of the API, without the version path segment.
    public let origin: URL

    /// Timeout applied to every request.
    ///
    /// The architecture requires explicit timeouts; URLSession's 60 second
    /// default is far too long for a health probe behind a user-visible screen.
    ///
    /// Source: architecture/ios-application-design.md, section "9. Networking".
    public let requestTimeout: TimeInterval

    public init(origin: URL, requestTimeout: TimeInterval = 10) {
        self.origin = origin
        self.requestTimeout = requestTimeout
    }

    /// The API base path. Breaking changes require a new major path.
    ///
    /// Source: packages/api-contracts, `API_BASE_PATH`.
    public static let basePath = "/v1"

    /// Header carrying the client-generated idempotency key on retryable mutations.
    public static let idempotencyKeyHeader = "Idempotency-Key"

    /// Header carrying the expected revision on revision-sensitive operations.
    public static let ifMatchHeader = "If-Match"

    /// Header carrying the client-generated correlation identifier.
    ///
    /// The OpenAPI document does not yet name this header; the response envelope
    /// only returns `correlationId`. This client convention is provisional and
    /// is replaced by the contract's name when `P1-OBS-01` pins it.
    public static let correlationIdHeader = "X-Correlation-Id"

    /// Header carrying the Firebase App Check token, the conventional name the
    /// backend reads for traffic classification.
    ///
    /// Source: architecture/identity-and-authorization.md, section "12. App Check".
    public static let appCheckHeader = "X-Firebase-AppCheck"

    /// Builds the absolute URL of a versioned operation path such as `health/live`.
    public func url(forOperationPath path: String) -> URL {
        origin
            .appendingPathComponent(Self.basePath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
            .appendingPathComponent(path)
    }
}
