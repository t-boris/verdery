import FirebaseAuth
import Foundation

/// Failures that originate in this adapter itself rather than in Firebase's
/// own reported error, for a completion handler that returns neither.
enum CoreAuthenticationError: Error {
    case noResultFromFirebase
    /// Firebase's `OAuthProvider`-based web sign-in flow is
    /// `@available(macOS, unavailable)`. Only reachable in the `swift build`/
    /// `swift test` macOS target this package builds for headless CI — see
    /// Package.swift, "no macOS product is shipped" — never in the shipped
    /// iOS app.
    case unsupportedOnThisPlatform
}

/// The only file in the application allowed to import `FirebaseAuth` besides
/// `FirebaseAuthTokenProvider`.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules".
public final class FirebaseAuthenticationGateway: AuthenticationGateway, Sendable {
    /// Where the pending email-link sign-in's address is held between "send"
    /// and "complete" — the link is normally opened by tapping it in Mail,
    /// which reopens this app with the original process state intact, but
    /// falling back to `UserDefaults` also covers the app having been
    /// terminated in between.
    private static let pendingEmailKey = "verdery.emailForSignIn"

    public init() {}

    #if os(iOS)
    @MainActor
    public func signInWithGoogle() async throws -> String {
        // Firebase's own web-based OAuth flow (an ASWebAuthenticationSession
        // it presents and manages internally via the default AuthUIDelegate)
        // — not the separate GoogleSignIn-iOS SDK, which this package does
        // not depend on.
        //
        // `signIn(with: FederatedAuthProvider, uiDelegate:)` only has a
        // completion-handler form in this Firebase SDK version — unlike
        // `signIn(withEmail:link:)` below, it has no `async` overload of its
        // own, and Swift does not auto-bridge it. Wrapped explicitly.
        let provider = OAuthProvider(providerID: "google.com")
        let result = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<AuthDataResult, Error>) in
            Auth.auth().signIn(with: provider, uiDelegate: nil) { authResult, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let authResult {
                    continuation.resume(returning: authResult)
                } else {
                    continuation.resume(throwing: CoreAuthenticationError.noResultFromFirebase)
                }
            }
        }
        return try await result.user.getIDToken()
    }

    /// Apple requires the `email` and `name` scopes to be requested
    /// explicitly, and returns them only on a user's very first
    /// authorization for this Services ID — Firebase still carries the
    /// verified email on every subsequent sign-in via the ID token itself,
    /// which is all this application reads.
    @MainActor
    public func signInWithApple() async throws -> String {
        let provider = OAuthProvider(providerID: "apple.com")
        provider.scopes = ["email", "name"]
        let result = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<AuthDataResult, Error>) in
            Auth.auth().signIn(with: provider, uiDelegate: nil) { authResult, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let authResult {
                    continuation.resume(returning: authResult)
                } else {
                    continuation.resume(throwing: CoreAuthenticationError.noResultFromFirebase)
                }
            }
        }
        return try await result.user.getIDToken()
    }
    #else
    // Firebase declares `signIn(with: FederatedAuthProvider, uiDelegate:)`
    // `@available(macOS, unavailable)`. This branch exists only so the
    // package still builds for macOS — see the type comment on
    // `CoreAuthenticationError.unsupportedOnThisPlatform` — and is never
    // compiled into the shipped iOS app.
    @MainActor
    public func signInWithGoogle() async throws -> String {
        throw CoreAuthenticationError.unsupportedOnThisPlatform
    }

    @MainActor
    public func signInWithApple() async throws -> String {
        throw CoreAuthenticationError.unsupportedOnThisPlatform
    }
    #endif

    public func sendEmailSignInLink(to email: String) async throws {
        let settings = ActionCodeSettings()
        settings.url = URL(string: "https://verdery-dev.firebaseapp.com/emailSignIn")
        settings.handleCodeInApp = true
        settings.setIOSBundleID(Bundle.main.bundleIdentifier ?? "com.verdery.app")

        try await Auth.auth().sendSignInLink(toEmail: email, actionCodeSettings: settings)
        UserDefaults.standard.set(email, forKey: Self.pendingEmailKey)
    }

    public func isSignInEmailLink(_ link: String) -> Bool {
        Auth.auth().isSignIn(withEmailLink: link)
    }

    public func completeEmailSignIn(email: String, link: String) async throws -> String {
        let result = try await Auth.auth().signIn(withEmail: email, link: link)
        UserDefaults.standard.removeObject(forKey: Self.pendingEmailKey)
        return try await result.user.getIDToken()
    }

    public func signOut() throws {
        try Auth.auth().signOut()
    }

    /// The address `sendEmailSignInLink` stored, for completing sign-in after
    /// the app was relaunched by tapping the link.
    public static func pendingEmailForSignIn() -> String? {
        UserDefaults.standard.string(forKey: pendingEmailKey)
    }
}
