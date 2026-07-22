import CoreDomain
import FirebaseAuth

/// Firebase-backed implementation of `CoreDomain.AuthTokenProvider`.
///
/// `getIDToken()` refreshes the token when Firebase's local copy is close to
/// expiring, so callers never need their own refresh logic — matching "the
/// native client refreshes credentials through the Firebase SDK."
///
/// Source: architecture/identity-and-authorization.md, section
/// "4. Native Authentication Flow".
public struct FirebaseAuthTokenProvider: AuthTokenProvider {
    public init() {}

    public func currentIdToken() async throws -> String? {
        guard let user = Auth.auth().currentUser else {
            return nil
        }
        return try await user.getIDToken()
    }
}
