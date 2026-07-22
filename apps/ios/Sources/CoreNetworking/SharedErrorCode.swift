/// Error codes shared across API modules.
///
/// Module-specific codes live with their module. These are the ones the request
/// pipeline itself can produce, so every client must handle them regardless of
/// which endpoint it called. The raw values mirror
/// `packages/api-contracts`'s `SharedErrorCode` exactly; a mismatch would make
/// the client silently stop recognizing a class of failure.
///
/// Source: architecture/api-design.md, section "Error envelope".
public enum SharedErrorCode: String, Sendable, CaseIterable {
    /// The request body or parameters failed contract validation.
    case requestInvalid = "request.invalid"
    /// Request or declared upload exceeds the permitted size.
    case requestTooLarge = "request.too_large"
    /// An idempotency key was reused with a different command.
    case idempotencyKeyReused = "request.idempotency.key_reused"
    /// Authentication credentials are missing or could not be verified.
    case unauthenticated = "auth.unauthenticated"
    /// The actor is authenticated but lacks the required capability.
    case forbidden = "auth.forbidden"
    /// The supplied revision precondition did not match the current revision.
    case staleRevision = "concurrency.stale_revision"
    /// A quota or rate limit was exceeded.
    case rateLimited = "quota.rate_limited"
    /// An unexpected internal failure occurred.
    case internalFailure = "server.internal"
    /// A required dependency is temporarily unavailable.
    case dependencyUnavailable = "server.dependency_unavailable"
}
