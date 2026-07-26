#if os(iOS)
import Foundation
import GoogleSignIn
import UIKit

/// What a completed native Google sign-in yields, reduced to the two values
/// Firebase needs to mint a credential.
///
/// `GIDSignInResult` itself never leaves ``GoogleSignInPresenter``: it is a
/// non-`Sendable` reference type, and both fields below are value types, so the
/// continuation that resumes this flow carries no reference across an isolation
/// boundary — the same rule ``AppleIdentityAssertion`` follows.
struct GoogleIdentityAssertion: Sendable {
    /// Google's signed JWT, which Firebase verifies against Google's keys.
    let idToken: String
    /// The OAuth access token issued alongside it. Firebase requires both.
    let accessToken: String
}

/// Failures this presenter raises itself, as distinct from the ones the
/// GoogleSignIn SDK reports.
enum GoogleSignInError: Error {
    /// ``GoogleSignInPresenter/configure(clientID:)`` was never called, so the
    /// SDK has no OAuth client to sign in against. Only reachable if the app
    /// entry point stopped configuring it — see `VerderyApp.init()`.
    case notConfigured
    /// The app has no key window to present from. See
    /// ``SignInPresentation/keyWindow()`` for why this is an error rather than
    /// a trap.
    case noPresentingViewController
    /// The SDK reported success but supplied no ID token. Firebase cannot mint
    /// a credential from the access token alone, and retrying with the same
    /// inputs would not change it.
    case missingIdentityToken
}

/// Runs Google's own native sign-in sheet and returns the resulting tokens.
///
/// This exists because Firebase's generic IDP web flow cannot complete Google
/// sign-in on a device. `Auth.signIn(with: OAuthProvider(providerID:
/// "google.com"))` opens `https://<project>.firebaseapp.com/__/auth/handler` in
/// an `SFSafariViewController`. That page writes the flow's state into the
/// browser's `sessionStorage` before redirecting to Google, and looks it up
/// again when Google redirects back — but `SFSafariViewController`'s storage is
/// partitioned from Safari's and discarded with the view controller, so the
/// lookup finds nothing and the page ends at **"Unable to process request due
/// to missing initial state."** That is what a real device reported on
/// TestFlight build 157. The handler page itself is served and answers `200`;
/// only its state is gone, which is why the failure looked intermittent rather
/// than absolute.
///
/// Sign in with Apple left the same generic flow for the same underlying reason
/// with a louder symptom — `OAuthProvider.init(providerID:auth:)` calls
/// `fatalError` for `apple.com` — see ``AppleSignInPresenter``. Google is the
/// last provider to follow, which is why nothing in this package still uses
/// Firebase's web flow.
///
/// Unlike Apple's, this flow has no system framework to lean on: the supported
/// path is Google's own `GoogleSignIn-iOS` SDK, the single dependency this
/// change adds.
///
/// Source: architecture/identity-and-authorization.md, section "3. Initial
/// Sign-In Methods".
@MainActor
public enum GoogleSignInPresenter {
    /// Points the SDK at this app's OAuth client.
    ///
    /// Called once, from the app entry point, immediately after
    /// `FirebaseApp.configure()` — the client ID is read from the bundled
    /// `GoogleService-Info.plist` through Firebase's own parsed options, so it
    /// is never repeated as a literal anywhere in the sources. The SDK also
    /// accepts a `GIDClientID` key in `Info.plist`; configuring it in code
    /// keeps the one copy of that value in the file Firebase already owns.
    public static func configure(clientID: String) {
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    }

    /// Presents the sheet and waits for the profile to accept or dismiss it.
    ///
    /// The completion-handler form rather than the bridged `async` one, and the
    /// tokens are read *inside* the callback so that only value types cross the
    /// continuation boundary: `GIDSignInResult` is a non-`Sendable` reference
    /// type, and resuming a continuation with one is a data race Swift 6's
    /// strict concurrency checking rejects outright. This is the same shape,
    /// for the same reason, that ``FirebaseAuthenticationGateway`` already uses
    /// for `AuthDataResult`.
    static func requestAssertion() async throws -> GoogleIdentityAssertion {
        guard GIDSignIn.sharedInstance.configuration != nil else {
            throw GoogleSignInError.notConfigured
        }

        guard let presenting = SignInPresentation.keyWindow()?.rootViewController else {
            throw GoogleSignInError.noPresentingViewController
        }

        return try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<GoogleIdentityAssertion, Error>) in
            GIDSignIn.sharedInstance.signIn(withPresenting: presenting) { result, error in
                if let error {
                    continuation.resume(throwing: mapped(error))
                } else if let idToken = result?.user.idToken?.tokenString,
                    let accessToken = result?.user.accessToken.tokenString
                {
                    continuation.resume(
                        returning: GoogleIdentityAssertion(
                            idToken: idToken,
                            accessToken: accessToken
                        )
                    )
                } else {
                    continuation.resume(throwing: GoogleSignInError.missingIdentityToken)
                }
            }
        }
    }

    /// Gives the SDK the chance to consume a URL the operating system delivered
    /// to the app, returning whether it claimed it.
    ///
    /// Returning `false` means the URL was not a Google sign-in callback and
    /// the caller should keep handling it — Firebase's email-link flow still
    /// needs its own turn. See ``FirebaseAuthenticationGateway/handleOpenURL(_:)``.
    static func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    /// Translates a dismissed sheet into ``CoreAuthenticationError/cancelledByUser``.
    ///
    /// Everything else is passed through untouched, so the SDK's own diagnosis
    /// — a keychain fault, an EMM policy, a network failure — survives to
    /// whatever logs it.
    ///
    /// `nonisolated` because its one caller is the SDK's completion block,
    /// which carries no isolation of its own: it inspects two value types and
    /// touches nothing on the main actor, so it does not need to be there.
    private nonisolated static func mapped(_ error: Error) -> Error {
        let error = error as NSError
        guard error.domain == kGIDSignInErrorDomain else { return error }

        return error.code == GIDSignInError.canceled.rawValue
            ? CoreAuthenticationError.cancelledByUser
            : error
    }
}
#endif
