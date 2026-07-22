/// Client-side Firebase sign-in.
///
/// Every method returns the freshly obtained ID token; nothing here talks to
/// the Verdery API — exchanging that token for a session, where a native
/// flow needs one at all, is `CoreNetworking.SessionGateway`'s job, kept
/// separate so this protocol has no HTTP dependency.
///
/// Sign in with Apple is deliberately absent: it awaits the repository
/// owner's own Apple Developer credentials (Services ID, Team ID, Key ID,
/// `.p8` key) before it can be configured in Firebase.
///
/// Source: architecture/identity-and-authorization.md, section
/// "3. Initial Sign-In Methods".
public protocol AuthenticationGateway: Sendable {
    @MainActor
    func signInWithGoogle() async throws -> String

    func sendEmailSignInLink(to email: String) async throws

    func isSignInEmailLink(_ link: String) -> Bool

    func completeEmailSignIn(email: String, link: String) async throws -> String

    func signOut() throws
}
