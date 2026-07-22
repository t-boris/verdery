import CoreDomain
import FirebaseAppCheck

/// Firebase-backed implementation of `CoreDomain.AppCheckTokenProvider`.
///
/// `token(forcingRefresh:)` returns the SDK's cached token when it has not
/// expired yet, so callers never need their own refresh logic — the same
/// division of responsibility as `FirebaseAuthTokenProvider`. `forcingRefresh`
/// stays `false`: this client has no way to distinguish a revoked token from
/// an expired one, and the SDK already refreshes proactively before
/// expiration, so there is no case where forcing a refresh here would be the
/// right call.
///
/// Source: architecture/identity-and-authorization.md, section "12. App Check".
public struct FirebaseAppCheckTokenProvider: AppCheckTokenProvider {
    public init() {}

    public func currentToken() async throws -> String? {
        try await AppCheck.appCheck().token(forcingRefresh: false).token
    }
}
