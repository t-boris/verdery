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

    /// Hands a URL the operating system delivered to the app back to the
    /// authentication SDK, returning whether the SDK claimed it.
    ///
    /// Firebase's federated web flow finishes by redirecting the browser to
    /// this app's custom URL scheme. The SDK presents that flow in an
    /// `SFSafariViewController`, which — unlike `ASWebAuthenticationSession` —
    /// does not intercept the redirect itself; iOS delivers it to the app, and
    /// the flow only completes once the app passes it back. Nothing did, so
    /// the browser sat on a blank page indefinitely. The SDK's own
    /// documentation states the requirement: "If swizzling is disabled, URLs
    /// received by the application delegate must be forwarded to this method."
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
