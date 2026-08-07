import Foundation

/// Client-side Firebase sign-in.
///
/// Every method returns the freshly obtained ID token; nothing here talks to
/// the Verdery API — exchanging that token for a session, where a native
/// flow needs one at all, is `CoreNetworking.SessionGateway`'s job, kept
/// separate so this protocol has no HTTP dependency.
///
/// Source: architecture/identity-and-authorization.md, section
/// "3. Initial Sign-In Methods".
public protocol AuthenticationGateway: Sendable {
    @MainActor
    func signInWithGoogle() async throws -> String

    @MainActor
    func signInWithApple() async throws -> String

    func sendEmailSignInLink(to email: String) async throws

    func isSignInEmailLink(_ link: String) -> Bool

    func completeEmailSignIn(email: String, link: String) async throws -> String

    func signOut() throws

    /// Revokes this app's Apple token, then signs out.
    ///
    /// Apple requires an app offering Sign in with Apple to revoke on account
    /// deletion rather than merely sign out, and checks for it at review. A
    /// revocation that fails is logged and swallowed: the account deletion it
    /// accompanies has already been accepted server-side, and refusing to
    /// finish the local teardown would leave somebody signed into an account
    /// that no longer exists.
    func revokeAppleTokenAndSignOut() async

    /// Hands a URL the operating system delivered to the app back to the
    /// authentication SDKs, returning whether one of them claimed it.
    ///
    /// A sign-in flow that leaves the app finishes by redirecting to a URL the
    /// OS delivers here, and the flow only completes once the app passes it
    /// back — both SDKs state the requirement, and while nothing did, a
    /// redirected browser sat on a blank page indefinitely. Google's SDK is
    /// offered the URL first (it started any flow arriving on this app's
    /// custom scheme), then Firebase, which the email magic link still needs.
    ///
    /// Returning `false` means the URL was not an authentication callback and
    /// the caller should keep handling it.
    @MainActor
    func handleOpenURL(_ url: URL) -> Bool

    /// The address ``sendEmailSignInLink(to:)`` recorded, if a sign-in link is
    /// still outstanding.
    ///
    /// Completing an email-link sign-in needs the address the link was sent
    /// to, and the link itself does not carry it. Exposed on the protocol so
    /// the composition layer can finish the flow when the link reopens the
    /// app, including after the app was terminated in between.
    var pendingEmailForSignIn: String? { get }
}
