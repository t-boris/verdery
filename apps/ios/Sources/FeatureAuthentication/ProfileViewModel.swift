import CoreAuthentication
import CoreLocalization
import Foundation
import Observation

/// View model for the account screen.
///
/// Every value it publishes has a real source. The identity comes from the
/// authentication SDK by way of `CoreAuthentication.AuthenticatedAccount`; the
/// version and build come from the app bundle; the language is the locale the
/// catalogue itself was resolved against. A field that is genuinely absent —
/// an email-link profile has no display name, a headless `swift build`
/// executable has no bundle version — produces no row rather than an empty
/// one.
///
/// Signing out reports success the same way signing in does: through Firebase's
/// state-change listener, which `CoreAuthentication.AuthenticationSessionObserver`
/// watches and `AppComposition.RootView` renders from. This model therefore
/// never tells the shell anything; it only records what happened, so a failure
/// can be shown in place.
///
/// Source: architecture/ios-application-design.md, sections "5.1 Presentation"
/// and "21. Dependency Rules"; architecture/identity-and-authorization.md,
/// section "4. Native Authentication Flow".
@MainActor
@Observable
public final class ProfileViewModel {
    public private(set) var state: ProfileViewState = .idle

    private let account: AuthenticatedAccount?
    private let appVersion: String?
    private let appBuild: String?
    private let locale: Locale
    private let authenticationGateway: any AuthenticationGateway
    private let strings: LocalizedStrings

    public init(
        account: AuthenticatedAccount?,
        appVersion: String?,
        appBuild: String?,
        locale: Locale,
        authenticationGateway: any AuthenticationGateway,
        strings: LocalizedStrings
    ) {
        self.account = account
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
        self.authenticationGateway = authenticationGateway
        self.strings = strings
    }

    public var title: String { strings(.profileTitle) }

    /// The one line that names the reader.
    ///
    /// The display name when a provider supplied one, the address otherwise,
    /// and — for a profile that has neither, which Firebase does permit — a
    /// plain statement that someone is signed in. Never blank.
    public var headline: String {
        account?.displayName ?? account?.emailAddress ?? strings(.profileSignedIn)
    }

    /// The address, shown only when it is not already the headline, so the
    /// same string is never printed twice.
    public var emailAddress: String? {
        guard let address = account?.emailAddress, address != headline else { return nil }

        return address
    }

    /// How this profile signs in, plus whether its address is confirmed.
    ///
    /// A provider identifier this app does not recognise is dropped rather
    /// than rendered raw: this application registers exactly three methods, so
    /// anything else is a state no honest label describes.
    public var badges: [ProfileBadge] {
        guard let account else { return [] }

        let providers: [AuthenticationProvider] = account.providerIdentifiers
            .compactMap(AuthenticationProvider.init(providerIdentifier:))
            .reduce(into: [AuthenticationProvider]()) { unique, provider in
                guard !unique.contains(provider) else { return }

                unique.append(provider)
            }

        var badges: [ProfileBadge] = providers.map { provider in
            switch provider {
            case .google:
                ProfileBadge(kind: .google, label: strings(.profileProviderGoogle))
            case .apple:
                ProfileBadge(kind: .apple, label: strings(.profileProviderApple))
            case .email:
                ProfileBadge(kind: .emailLink, label: strings(.profileProviderEmail))
            }
        }

        if account.emailAddress != nil {
            badges.append(
                account.isEmailVerified
                    ? ProfileBadge(kind: .addressConfirmed, label: strings(.profileEmailVerified))
                    : ProfileBadge(kind: .addressUnconfirmed, label: strings(.profileEmailUnverified))
            )
        }

        return badges
    }

    public var aboutTitle: String { strings(.profileSectionAbout) }

    /// What this build is, as far as the build itself can say.
    public var facts: [ProfileFact] {
        var facts: [ProfileFact] = []

        if let appVersion {
            facts.append(ProfileFact(kind: .version, label: strings(.profileAppVersion), value: appVersion))
        }
        if let appBuild {
            facts.append(ProfileFact(kind: .build, label: strings(.profileAppBuild), value: appBuild))
        }
        if let language = languageName {
            facts.append(ProfileFact(kind: .language, label: strings(.profileAppLanguage), value: language))
        }

        return facts
    }

    public var notificationsTitle: String { strings(.notificationPreferencesOpen) }
    public var exportTitle: String { strings(.exportOpen) }
    public var deleteAccountTitle: String { strings(.deleteAccountOpen) }
    public var signOutTitle: String { strings(.shellSignOut) }
    public var signOutConfirmTitle: String { strings(.profileSignOutConfirmTitle) }
    public var signOutConfirmMessage: String { strings(.profileSignOutConfirmMessage) }
    public var signOutCancelTitle: String { strings(.profileSignOutCancel) }

    public var failureMessage: String? {
        guard case let .failed(message) = state else { return nil }

        return message
    }

    /// Ends the session.
    ///
    /// Synchronous because the gateway is: `Auth.auth().signOut()` clears the
    /// local session and returns. Nothing is awaited and nothing is returned
    /// because the shell is not listening to this call — it is listening to
    /// the SDK, which posts the state change this triggers.
    public func signOut() {
        do {
            try authenticationGateway.signOut()
            state = .signedOut
        } catch {
            state = .failed(message: strings(.profileSignOutFailed))
        }
    }

    /// The reader's language, named in that language.
    ///
    /// `nil` when the locale carries no language code, which is the only case
    /// where there is nothing true to print.
    private var languageName: String? {
        guard
            let code = locale.language.languageCode?.identifier,
            let name = locale.localizedString(forLanguageCode: code)
        else {
            return nil
        }

        return name.localizedCapitalized
    }
}
