#if os(iOS)
import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

/// What a completed native Sign in with Apple authorization yields, reduced to
/// the values Firebase needs.
///
/// `ASAuthorizationAppleIDCredential` itself never leaves
/// ``AppleSignInPresenter``: it is a non-`Sendable` reference type, and every
/// field below is a value type, so the continuation that resumes this flow
/// carries no reference across an isolation boundary.
struct AppleIdentityAssertion: Sendable {
    /// Apple's signed JWT, which Firebase verifies against Apple's keys.
    let identityToken: String
    /// Present only on a profile's very first authorization for this app;
    /// Apple never sends it again, which is why Firebase asks for it here
    /// rather than reading it from a later token.
    let fullName: PersonNameComponents?
}

/// Failures this presenter raises itself, as distinct from the ones
/// `AuthenticationServices` reports.
enum AppleSignInError: Error {
    /// Apple returned an authorization that was not an Apple ID credential, or
    /// one whose identity token was absent or not UTF-8. Neither is
    /// recoverable by retrying with the same inputs.
    case missingIdentityToken
    /// `SecRandomCopyBytes` refused to produce entropy. Treated as a failure
    /// rather than falling back to a weaker source: the nonce is the whole of
    /// the replay protection on the returned assertion.
    case nonceGenerationFailed
}

/// Runs Apple's own native Sign in with Apple sheet and returns the resulting
/// identity assertion.
///
/// This exists because Firebase's generic `OAuthProvider` web flow *traps* for
/// `apple.com`. The SDK's own `OAuthProvider.init(providerID:auth:)` reads:
///
///     if providerID == AuthProviderID.apple.rawValue {
///       fatalError("Sign in with Apple is not supported via generic IDP; You
///       must use the Apple SDK for Sign in with Apple.")
///     }
///
/// so constructing one was an unconditional crash, not a recoverable error —
/// which is exactly what a device build did (`EXC_BREAKPOINT` in
/// `OAuthProvider.init`, faulting thread `com.apple.main-thread`). The
/// supported path is the one below: `ASAuthorizationAppleIDProvider` with a
/// nonce, then `OAuthProvider.appleCredential(withIDToken:rawNonce:fullName:)`.
/// `AuthenticationServices` and `CryptoKit` are system frameworks, so this
/// adds no package dependency.
///
/// Source: architecture/identity-and-authorization.md, section "3. Initial
/// Sign-In Methods".
@MainActor
final class AppleSignInPresenter: NSObject {
    /// Resumed exactly once, by whichever delegate callback Apple invokes
    /// first, and cleared in the same step so a second callback — which the
    /// framework does not promise it will never send — cannot resume a
    /// continuation twice.
    private var continuation: CheckedContinuation<AppleIdentityAssertion, Error>?

    /// Holds the in-flight controller alive. `ASAuthorizationController` keeps
    /// only an unowned reference to its delegate and is itself deallocated the
    /// moment the last strong reference goes away, which — without this — is
    /// the end of `requestAssertion`'s own scope, well before the sheet
    /// resolves.
    private var controller: ASAuthorizationController?

    /// Presents the sheet and waits for the profile to accept or cancel.
    ///
    /// - Parameter hashedNonce: the SHA-256 of the raw nonce, which is what
    ///   Apple embeds in the returned token. The raw value stays with the
    ///   caller and is handed to Firebase separately, so a token intercepted
    ///   in transit cannot be replayed without it.
    func requestAssertion(hashedNonce: String) async throws -> AppleIdentityAssertion {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = hashedNonce

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    /// A fresh 32-byte nonce, URL-safe base64 encoded.
    ///
    /// `SecRandomCopyBytes` rather than `SystemRandomNumberGenerator`: the
    /// latter's cryptographic strength is documented as a property of whatever
    /// facility the platform happens to offer, and this value is the only
    /// thing binding Apple's assertion to this one sign-in attempt.
    static func makeRawNonce() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw AppleSignInError.nonceGenerationFailed
        }

        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The lowercase hexadecimal SHA-256 of `nonce`, the encoding Apple's
    /// `nonce` request field expects.
    static func hashed(nonce: String) -> String {
        SHA256.hash(data: Data(nonce.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func finish(with result: Result<AppleIdentityAssertion, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        self.controller = nil
        continuation.resume(with: result)
    }
}

extension AppleSignInPresenter: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            finish(with: .failure(AppleSignInError.missingIdentityToken))
            return
        }

        finish(
            with: .success(
                AppleIdentityAssertion(
                    identityToken: identityToken,
                    fullName: credential.fullName
                )
            )
        )
    }

    func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        finish(with: .failure(error))
    }
}

extension AppleSignInPresenter: ASAuthorizationControllerPresentationContextProviding {
    /// The scene's key window.
    ///
    /// A bare `ASPresentationAnchor()` fallback rather than a trap: an app with
    /// no key window cannot be showing the sign-in button that started this,
    /// so the branch is unreachable in practice, and crashing would be a worse
    /// answer than letting `AuthenticationServices` report its own error.
    func presentationAnchor(for _: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
#endif
