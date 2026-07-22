/// What `CoreNetworking` needs from App Check: a fresh attestation token to
/// attach to a request. Declared here, not in `CoreNetworking` itself, and
/// implemented by `CoreAuthentication`'s Firebase adapter — networking
/// depends on this protocol, never on Firebase or on the authentication
/// module directly. Mirrors `AuthTokenProvider`'s reasoning exactly; App
/// Check is a distinct Firebase product, not a variant of ID token auth, so
/// it gets its own protocol rather than an extra method on that one.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules" ("Firebase ... types remain inside adapters or feature
/// infrastructure"); architecture/identity-and-authorization.md, section
/// "12. App Check" ("Integrate token generation and backend verification.").
public protocol AppCheckTokenProvider: Sendable {
    /// The current Firebase App Check token. `nil` when no token could be
    /// obtained.
    func currentToken() async throws -> String?
}
