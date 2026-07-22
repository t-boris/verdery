import CoreAuthentication
import CoreLocalization
import Observation

/// View model for the sign-in screen.
///
/// Success is not reported by returning to a caller: `AppComposition`'s
/// `AuthenticationSessionObserver` reacts to Firebase's own state-change
/// listener and switches `RootScene` away from this screen, the same
/// reactive pattern the whole native flow relies on to avoid a second,
/// independently-maintained "am I signed in" flag.
///
/// Source: architecture/ios-application-design.md, sections "5.1 Presentation"
/// and "21. Dependency Rules"; implementation-plan.md work package P2-AUTH-03.
@MainActor
@Observable
public final class SignInViewModel {
    public private(set) var state: SignInViewState = .idle
    public var email: String = ""

    private let authenticationGateway: any AuthenticationGateway
    private let strings: LocalizedStrings

    public init(authenticationGateway: any AuthenticationGateway, strings: LocalizedStrings) {
        self.authenticationGateway = authenticationGateway
        self.strings = strings
    }

    public var title: String { strings(.authSignInTitle) }
    public var description: String { strings(.authSignInDescription) }
    public var googleActionTitle: String { strings(.authSignInGoogle) }
    public var appleActionTitle: String { strings(.authSignInApple) }
    public var emailLabel: String { strings(.authSignInEmailLabel) }
    public var emailSubmitTitle: String { strings(.authSignInEmailSubmit) }
    public var emailSentTitle: String { strings(.authSignInEmailSent) }
    public var emailSentDescription: String { strings(.authSignInEmailSentDescription) }

    public func signInWithGoogle() async {
        state = .signingIn

        do {
            _ = try await authenticationGateway.signInWithGoogle()
            state = .idle
        } catch {
            state = .failed(message: strings(.authSignInFailed))
        }
    }

    public func signInWithApple() async {
        state = .signingIn

        do {
            _ = try await authenticationGateway.signInWithApple()
            state = .idle
        } catch {
            state = .failed(message: strings(.authSignInFailed))
        }
    }

    public func sendEmailSignInLink() async {
        guard !email.isEmpty else { return }

        state = .signingIn

        do {
            try await authenticationGateway.sendEmailSignInLink(to: email)
            state = .emailLinkSent
        } catch {
            state = .failed(message: strings(.authSignInFailed))
        }
    }
}
