import FeatureGardens
import Foundation

/// `handleIncomingURL(_:)` — split from `AppCompositionRoot.swift` when this
/// file's own size argued for it (that file is already near this
/// repository's 600-line ceiling — see `AccountEntryPoint.swift`'s identical
/// reasoning). A same-type extension in another file is how this module
/// already splits (`AppCompositionRoot+LocalStores.swift`).
extension AppCompositionRoot {
    /// Routes a URL the operating system delivered to the app.
    ///
    /// Three kinds of URL reopen this app, and none complete unless something
    /// consumes them:
    ///
    /// 1. This app's OWN `verdery://` deep links (P9A-IOS-01) — an invitation
    ///    accept link or an ownership-transfer review link, both handled by
    ///    ``CollaborationSessionState/handleDeepLink(_:)``. Checked first:
    ///    its scheme check is cheap and this app's own links must never be
    ///    mistaken for a sign-in callback.
    /// 2. The federated web flow (Google) redirects to this app's registered
    ///    custom scheme. Firebase presents that flow in an
    ///    `SFSafariViewController`, which does not intercept its own redirect,
    ///    so the SDK has to be handed the URL — otherwise the browser is left
    ///    on a blank page forever, which is exactly what a device build did.
    /// 3. The email sign-in link returns as a link Firebase recognizes, and
    ///    completing it also needs the address the link was sent to, which
    ///    `AuthenticationGateway.pendingEmailForSignIn` holds.
    ///
    /// Nothing observes the sign-in result: success is reported by Firebase's
    /// own auth state listener, which `AuthenticationSessionObserver` already
    /// watches and `RootView` already renders from — the same reactive path
    /// every other sign-in method reports through, rather than a second flag.
    /// The collaboration deep links above ARE observed, through
    /// `collaborationSessionState` itself, which is `@Observable`.
    @discardableResult
    public func handleIncomingURL(_ url: URL) -> Bool {
        if collaborationSessionState.handleDeepLink(url) {
            return true
        }

        if authenticationGateway.handleOpenURL(url) {
            return true
        }

        let link = url.absoluteString
        guard
            authenticationGateway.isSignInEmailLink(link),
            let email = authenticationGateway.pendingEmailForSignIn
        else {
            return false
        }

        Task { [authenticationGateway] in
            _ = try? await authenticationGateway.completeEmailSignIn(email: email, link: link)
        }

        return true
    }
}
