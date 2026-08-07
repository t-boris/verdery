import CoreAuthentication
import CoreLocalization
import Foundation
import Testing

@testable import FeatureAuthentication

/// The screen is tested through the authentication gateway protocol, with no
/// Firebase SDK, no GoogleSignIn SDK, and no signed-in device — the same
/// property `ProfileViewModelTests` relies on.
///
/// What these tests exist for is the one distinction the native sign-in flows
/// made necessary: a reader who dismisses Google's or Apple's own sheet has not
/// hit an error, and must not be shown one.
///
/// Source: architecture/ios-application-design.md, section "19. Testing".
private struct StubAuthenticationGateway: AuthenticationGateway {
    let signInError: (any Error)?

    init(signInError: (any Error)? = nil) {
        self.signInError = signInError
    }

    @MainActor
    func signInWithGoogle() async throws -> String {
        if let signInError { throw signInError }
        return "token"
    }

    @MainActor
    func signInWithApple() async throws -> String {
        if let signInError { throw signInError }
        return "token"
    }

    func sendEmailSignInLink(to email: String) async throws {
        if let signInError { throw signInError }
    }

    func isSignInEmailLink(_ link: String) -> Bool { false }

    func completeEmailSignIn(email: String, link: String) async throws -> String { "token" }

    func revokeAppleTokenAndSignOut() async {
        try? signOut()
    }

    func signOut() throws {}

    @MainActor
    func handleOpenURL(_ url: URL) -> Bool { false }

    var pendingEmailForSignIn: String? { nil }
}

private struct SignInFailure: Error {}

@MainActor
@Suite("Sign-in view model")
struct SignInViewModelTests {
    private func makeModel(
        gateway: StubAuthenticationGateway = StubAuthenticationGateway(),
        locale: Locale = Locale(identifier: "en_GB")
    ) -> SignInViewModel {
        SignInViewModel(
            authenticationGateway: gateway,
            strings: LocalizedStrings(locale: locale)
        )
    }

    @Test("Starts idle so nothing is claimed before the reader acts")
    func startsIdle() {
        #expect(makeModel().state == .idle)
    }

    /// Success does not navigate from here: `AuthenticationSessionObserver`
    /// reacts to Firebase's own state change and swaps the root scene, so the
    /// screen's own job is only to stop showing progress.
    @Test("A completed Google sign-in leaves the screen at rest")
    func googleSuccessReturnsToIdle() async {
        let model = makeModel()

        await model.signInWithGoogle()

        #expect(model.state == .idle)
    }

    @Test("Dismissing Google's sheet is not an error")
    func googleCancellationShowsNoMessage() async {
        let model = makeModel(
            gateway: StubAuthenticationGateway(signInError: CoreAuthenticationError.cancelledByUser)
        )

        await model.signInWithGoogle()

        #expect(model.state == .idle)
    }

    @Test("Dismissing Apple's sheet is not an error")
    func appleCancellationShowsNoMessage() async {
        let model = makeModel(
            gateway: StubAuthenticationGateway(signInError: CoreAuthenticationError.cancelledByUser)
        )

        await model.signInWithApple()

        #expect(model.state == .idle)
    }

    @Test("A real Google failure still reports itself, localized")
    func googleFailureIsReported() async {
        let model = makeModel(gateway: StubAuthenticationGateway(signInError: SignInFailure()))

        await model.signInWithGoogle()

        #expect(model.state == .failed(message: "Sign-in did not succeed. Try again."))
    }

    @Test("A real Apple failure still reports itself, in the reader's language")
    func appleFailureIsReportedInRussian() async {
        let model = makeModel(
            gateway: StubAuthenticationGateway(signInError: SignInFailure()),
            locale: Locale(identifier: "ru_RU")
        )

        await model.signInWithApple()

        #expect(model.state == .failed(message: "Не удалось войти. Попробуйте снова."))
    }
}
