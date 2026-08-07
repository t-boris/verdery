import CoreAuthentication
import CoreLocalization
import Foundation
import Testing

@testable import FeatureAuthentication

/// The screen is tested through the authentication gateway protocol, with no
/// Firebase SDK and no signed-in device. That is the property the dependency
/// rule exists to protect.
///
/// Source: architecture/ios-application-design.md, section "19. Testing".
private struct StubAuthenticationGateway: AuthenticationGateway {
    let signOutError: (any Error)?

    init(signOutError: (any Error)? = nil) {
        self.signOutError = signOutError
    }

    /// Records that `signOut()` was called, even when it then throws.
    ///
    /// A reference box rather than a `var`: the protocol is `Sendable` and its
    /// method is not `mutating`, and the failure test has to prove the call
    /// reached the gateway before the error came back.
    final class Calls: @unchecked Sendable {
        private(set) var signOutCount = 0
        func recordSignOut() { signOutCount += 1 }
    }

    let calls = Calls()

    @MainActor
    func signInWithGoogle() async throws -> String { "token" }

    @MainActor
    func signInWithApple() async throws -> String { "token" }

    func sendEmailSignInLink(to email: String) async throws {}

    func isSignInEmailLink(_ link: String) -> Bool { false }

    func completeEmailSignIn(email: String, link: String) async throws -> String { "token" }

    func revokeAppleTokenAndSignOut() async {
        try? signOut()
    }

    func signOut() throws {
        calls.recordSignOut()
        if let signOutError {
            throw signOutError
        }
    }

    @MainActor
    func handleOpenURL(_ url: URL) -> Bool { false }

    var pendingEmailForSignIn: String? { nil }
}

private struct SignOutFailure: Error {}

@MainActor
@Suite("Profile view model")
struct ProfileViewModelTests {
    private func makeModel(
        account: AuthenticatedAccount? = .googleFixture,
        appVersion: String? = "1.4",
        appBuild: String? = "153",
        locale: Locale = Locale(identifier: "en_GB"),
        gateway: StubAuthenticationGateway = StubAuthenticationGateway()
    ) -> ProfileViewModel {
        ProfileViewModel(
            account: account,
            appVersion: appVersion,
            appBuild: appBuild,
            locale: locale,
            authenticationGateway: gateway,
            strings: LocalizedStrings(locale: locale)
        )
    }

    @Test("Starts idle so nothing is claimed before the reader acts")
    func startsIdle() {
        #expect(makeModel().state == .idle)
        #expect(makeModel().failureMessage == nil)
    }

    @Test("The display name names the reader when a provider supplied one")
    func prefersDisplayName() {
        let model = makeModel()

        #expect(model.headline == "Ada Lovelace")
        #expect(model.emailAddress == "ada@example.com")
    }

    /// An email-link profile has no display name at all, so the address is
    /// promoted to the headline — and must not then be printed twice.
    @Test("Without a display name the address becomes the headline, once")
    func fallsBackToAddress() {
        let model = makeModel(account: .emailLinkFixture)

        #expect(model.headline == "grower@example.com")
        #expect(model.emailAddress == nil)
    }

    /// Firebase permits a profile with neither, and a blank headline would be
    /// the one thing the screen must never render.
    @Test("A profile with no name and no address still says something true")
    func neverRendersABlankHeadline() {
        let model = makeModel(account: .anonymousFixture)

        #expect(model.headline == "Signed in")
        #expect(model.emailAddress == nil)
        #expect(model.badges.isEmpty)
    }

    @Test("No account at all produces no identity and no badges")
    func toleratesAMissingAccount() {
        let model = makeModel(account: nil)

        #expect(model.headline == "Signed in")
        #expect(model.emailAddress == nil)
        #expect(model.badges.isEmpty)
    }

    @Test("The sign-in method and the address state are badged")
    func badgesProviderAndVerification() {
        let model = makeModel()

        #expect(model.badges.map(\.kind) == [.google, .addressConfirmed])
        #expect(model.badges.map(\.label) == ["Google account", "Address confirmed"])
    }

    @Test("An unconfirmed address is badged as unconfirmed")
    func badgesAnUnconfirmedAddress() {
        let model = makeModel(account: .emailLinkFixture)

        #expect(model.badges.map(\.kind) == [.emailLink, .addressUnconfirmed])
    }

    /// A provider this application never registers cannot be described
    /// honestly, so it is dropped rather than rendered as a raw identifier.
    @Test("An unrecognised provider is dropped, and duplicates collapse")
    func ignoresUnknownProviders() {
        let model = makeModel(account: .duplicatedProviderFixture)

        #expect(model.badges.map(\.kind) == [.apple, .addressConfirmed])
    }

    @Test("The build's own figures come from the bundle")
    func reportsBuildFigures() {
        let facts = makeModel().facts

        #expect(facts.map(\.kind) == [.version, .build, .language])
        #expect(facts.map(\.value) == ["1.4", "153", "English"])
        #expect(facts.map(\.label) == ["Version", "Build", "Language"])
    }

    /// The headless SPM executable has no `Info.plist`, so both figures are
    /// genuinely absent there. A row labelled with nothing beside it would be
    /// worse than no row.
    @Test("A figure the bundle does not carry produces no row")
    func omitsAbsentFigures() {
        let facts = makeModel(appVersion: nil, appBuild: nil).facts

        #expect(facts.map(\.kind) == [.language])
    }

    @Test("The language is named in the reader's own language")
    func namesTheLanguageForTheReader() {
        let facts = makeModel(locale: Locale(identifier: "ru_RU")).facts

        #expect(facts.first(where: { $0.kind == .language })?.value == "Русский")
        #expect(facts.first(where: { $0.kind == .language })?.label == "Язык")
    }

    @Test("Signing out goes through the gateway and records that it finished")
    func signsOut() {
        let gateway = StubAuthenticationGateway()
        let model = makeModel(gateway: gateway)

        model.signOut()

        #expect(gateway.calls.signOutCount == 1)
        #expect(model.state == .signedOut)
        #expect(model.failureMessage == nil)
    }

    /// The one failure path that matters: the session did not end, so the
    /// screen must say so instead of leaving the reader believing it did.
    @Test("A failed sign-out is reported in place, not swallowed")
    func reportsSignOutFailure() {
        let gateway = StubAuthenticationGateway(signOutError: SignOutFailure())
        let model = makeModel(gateway: gateway)

        model.signOut()

        #expect(gateway.calls.signOutCount == 1)
        #expect(model.state == .failed(message: "Signing out did not finish. Try again."))
        #expect(model.failureMessage == "Signing out did not finish. Try again.")
    }

    @Test("A failure is reported in the reader's language")
    func reportsFailureInRussian() {
        let model = makeModel(
            locale: Locale(identifier: "ru_RU"),
            gateway: StubAuthenticationGateway(signOutError: SignOutFailure())
        )

        model.signOut()

        #expect(model.failureMessage == "Выйти не удалось. Попробуйте ещё раз.")
    }

    @Test("Every label the screen shows is localized, in both catalogues")
    func labelsAreLocalized() {
        let english = makeModel()
        let russian = makeModel(locale: Locale(identifier: "ru_RU"))

        #expect(english.title == "Account")
        #expect(russian.title == "Аккаунт")
        #expect(english.signOutTitle == "Sign out")
        #expect(russian.signOutTitle == "Выйти")
        #expect(russian.signOutConfirmTitle == "Выйти из Verdery?")
        #expect(!russian.signOutConfirmMessage.isEmpty)
        #expect(russian.signOutCancelTitle == "Остаться в аккаунте")
        #expect(russian.aboutTitle == "Эта сборка")
    }
}

extension AuthenticatedAccount {
    fileprivate static let googleFixture = AuthenticatedAccount(
        uid: "uid-1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
        isEmailVerified: true,
        providerIdentifiers: ["google.com"]
    )

    fileprivate static let emailLinkFixture = AuthenticatedAccount(
        uid: "uid-2",
        displayName: nil,
        emailAddress: "grower@example.com",
        isEmailVerified: false,
        providerIdentifiers: ["password"]
    )

    fileprivate static let anonymousFixture = AuthenticatedAccount(
        uid: "uid-3",
        displayName: nil,
        emailAddress: nil,
        isEmailVerified: false,
        providerIdentifiers: []
    )

    fileprivate static let duplicatedProviderFixture = AuthenticatedAccount(
        uid: "uid-4",
        displayName: "Grace",
        emailAddress: "grace@example.com",
        isEmailVerified: true,
        providerIdentifiers: ["apple.com", "apple.com", "oidc.enterprise"]
    )
}

@Suite("Authentication provider identifiers")
struct AuthenticationProviderTests {
    @Test("Each registered sign-in method is recognised")
    func recognisesRegisteredMethods() {
        #expect(AuthenticationProvider(providerIdentifier: "google.com") == .google)
        #expect(AuthenticationProvider(providerIdentifier: "apple.com") == .apple)
        #expect(AuthenticationProvider(providerIdentifier: "password") == .email)
        #expect(AuthenticationProvider(providerIdentifier: "emailLink") == .email)
    }

    @Test("Anything else is unrecognised rather than guessed at")
    func rejectsUnknownIdentifiers() {
        #expect(AuthenticationProvider(providerIdentifier: "facebook.com") == nil)
        #expect(AuthenticationProvider(providerIdentifier: "") == nil)
    }
}
