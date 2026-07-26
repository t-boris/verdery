import FirebaseAuth
import Foundation

/// Outcomes this module reports itself, rather than passing an SDK's own error
/// through.
///
/// Public because the sign-in screen has to be able to tell one of them —
/// ``cancelledByUser`` — apart from a real failure; see
/// `FeatureAuthentication.SignInViewModel`.
public enum CoreAuthenticationError: Error {
    /// The reader dismissed the provider's own sheet without signing in.
    ///
    /// Not a failure: nothing went wrong, and the screen must return to rest
    /// rather than accuse the reader of an error they caused deliberately.
    /// Both native providers report it — Apple as `ASAuthorizationError
    /// .canceled`, Google as `GIDSignInErrorCode.canceled` — and both are
    /// translated to this one case at the edge, so the screen has a single
    /// thing to recognize.
    case cancelledByUser
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

    /// The `continue URL` the emailed sign-in link carries, and the page a
    /// reader who opens that link actually lands on.
    ///
    /// Injected rather than compiled in, for the same reason the API origin
    /// is (`AppComposition.AppEnvironment`): it names a deployed environment,
    /// and this file had the wrong one hard-coded —
    /// `https://verdery-dev.firebaseapp.com/emailSignIn`, a host that serves
    /// Firebase's own "Site Not Found" page with HTTP 404 because this
    /// project has no Firebase Hosting site. Firebase generated and mailed
    /// the link perfectly happily; it simply led nowhere, which is exactly
    /// what "the email never arrives with anything usable" looks like from
    /// the outside.
    private let emailSignInContinueURL: URL

    public init(emailSignInContinueURL: URL) {
        self.emailSignInContinueURL = emailSignInContinueURL
    }

    #if os(iOS)
    /// Google's own native sign-in sheet, not Firebase's generic web flow.
    ///
    /// The generic flow — `Auth.signIn(with: OAuthProvider(providerID:
    /// "google.com"))`, which this method used through TestFlight build 157 —
    /// cannot complete on a device: it runs in an `SFSafariViewController`
    /// whose `sessionStorage` is partitioned and discarded, so Firebase's
    /// handler page cannot find its own state when Google redirects back and
    /// ends at "Unable to process request due to missing initial state". See
    /// ``GoogleSignInPresenter`` for the full account.
    ///
    /// Removing this last caller left the generic `signIn(providerID:scopes:)`
    /// helper with none, so it was deleted rather than left behind as a
    /// web-flow path nothing can reach.
    @MainActor
    public func signInWithGoogle() async throws -> String {
        let assertion = try await GoogleSignInPresenter.requestAssertion()

        return try await exchangeGoogleAssertion(
            idToken: assertion.idToken,
            accessToken: assertion.accessToken
        )
    }

    /// Deliberately `nonisolated`, and taking only value types — see
    /// ``exchangeAppleAssertion(identityToken:rawNonce:fullName:)`` below for
    /// why: `AuthDataResult` is a non-`Sendable` reference type that must not
    /// cross back to the main actor.
    private func exchangeGoogleAssertion(
        idToken: String,
        accessToken: String
    ) async throws -> String {
        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: accessToken
        )
        let result = try await Auth.auth().signIn(with: credential)
        return try await result.user.getIDToken()
    }

    /// Apple's own native authorization sheet, not Firebase's generic web
    /// flow.
    ///
    /// The generic flow is not merely discouraged for `apple.com` — it traps.
    /// `OAuthProvider.init(providerID:auth:)` calls `fatalError("Sign in with
    /// Apple is not supported via generic IDP; You must use the Apple SDK for
    /// Sign in with Apple.")` for this provider ID whenever no auth emulator
    /// is configured, so the previous implementation terminated the app the
    /// instant the button was tapped. See ``AppleSignInPresenter`` for the
    /// crash report this reproduces from.
    ///
    /// The nonce is generated here and used twice: its SHA-256 goes to Apple,
    /// which embeds it in the signed token, and the raw value goes to
    /// Firebase, which checks the two agree. That is what stops a token
    /// captured in transit from being replayed.
    @MainActor
    public func signInWithApple() async throws -> String {
        let rawNonce = try AppleSignInPresenter.makeRawNonce()
        let presenter = AppleSignInPresenter()
        let assertion = try await presenter.requestAssertion(
            hashedNonce: AppleSignInPresenter.hashed(nonce: rawNonce)
        )

        return try await exchangeAppleAssertion(
            identityToken: assertion.identityToken,
            rawNonce: rawNonce,
            fullName: assertion.fullName
        )
    }

    /// Deliberately `nonisolated`, and taking only value types.
    ///
    /// `AuthDataResult` is a non-`Sendable` reference type, so awaiting
    /// `signIn(with:)` from the main actor would return one across an
    /// isolation boundary — which Swift 6 rejects. Keeping the whole exchange
    /// off the main actor means only the resulting `String` ever crosses back,
    /// the same shape ``signIn(providerID:scopes:)`` uses for its own reason.
    private func exchangeAppleAssertion(
        identityToken: String,
        rawNonce: String,
        fullName: PersonNameComponents?
    ) async throws -> String {
        let credential = OAuthProvider.appleCredential(
            withIDToken: identityToken,
            rawNonce: rawNonce,
            fullName: fullName
        )
        let result = try await Auth.auth().signIn(with: credential)
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

    /// Sends the sign-in link, pointed at the deployed web handler.
    ///
    /// `handleCodeInApp` and the iOS bundle ID stay set, so the link is still
    /// eligible to be captured by this app the day it can be: capture needs
    /// an Associated Domains entitlement and an `apple-app-site-association`
    /// served by the continue URL's host, neither of which exists yet — see
    /// `AppComposition.AppEnvironment.emailSignInContinueURL`. Until then the
    /// link opens in a browser and completes the sign-in there, on a page
    /// that is deployed and answers `200`, instead of a 404.
    public func sendEmailSignInLink(to email: String) async throws {
        let settings = ActionCodeSettings()
        settings.url = emailSignInContinueURL
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

    /// Forwards an incoming URL to each SDK that might be waiting for it.
    ///
    /// Google's SDK gets first refusal: its OAuth redirect arrives on this
    /// app's `CFBundleURLSchemes` entry (the reversed client ID), and
    /// `GIDSignIn.handle(_:)` claims it only while a sign-in it started is
    /// actually outstanding. Firebase keeps its turn unconditionally
    /// afterwards, because the email-link flow still depends on it: `canHandle`
    /// likewise returns `true` only while a flow is waiting for this exact
    /// callback, so calling it for every URL the app receives is safe, and
    /// calling it twice for the same URL — which happens if the SDK's delegate
    /// swizzling is also active — is a no-op the second time.
    @MainActor
    public func handleOpenURL(_ url: URL) -> Bool {
        #if os(iOS)
        if GoogleSignInPresenter.handle(url) {
            return true
        }

        return Auth.auth().canHandle(url)
        #else
        return false
        #endif
    }

    public var pendingEmailForSignIn: String? {
        Self.pendingEmailForSignIn()
    }

    /// The address `sendEmailSignInLink` stored, for completing sign-in after
    /// the app was relaunched by tapping the link.
    public static func pendingEmailForSignIn() -> String? {
        UserDefaults.standard.string(forKey: pendingEmailKey)
    }
}
