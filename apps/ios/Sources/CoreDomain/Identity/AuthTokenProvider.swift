/// What `CoreNetworking` needs from authentication: a fresh credential to
/// attach to a request. Declared here, not in `CoreNetworking` itself, and
/// implemented by `CoreAuthentication`'s Firebase adapter — networking
/// depends on this protocol, never on Firebase or on the authentication
/// module directly.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules" ("Firebase ... types remain inside adapters or feature
/// infrastructure"); architecture/identity-and-authorization.md, section
/// "4. Native Authentication Flow" ("The native client refreshes credentials
/// through the Firebase SDK. The API does not receive or store provider
/// refresh tokens.").
public protocol AuthTokenProvider: Sendable {
    /// The current Firebase ID token, refreshed by the SDK as needed.
    /// `nil` when no profile is signed in.
    func currentIdToken() async throws -> String?
}
