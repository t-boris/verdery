import Foundation

/// The identity the client already holds for the signed-in profile.
///
/// A plain value, deliberately free of any Firebase type: it is built inside
/// this module's adapter (see `AuthenticationSessionObserver`) and read by
/// presentation code, which must never see a `FirebaseAuth.User` — see
/// architecture/ios-application-design.md, section "21. Dependency Rules".
///
/// Every field here is something the authentication SDK genuinely reports.
/// Nothing is invented, and the optional fields are optional because they are
/// really absent for some sign-in methods: an email-link profile has no
/// display name, and a profile can exist with no address at all.
public struct AuthenticatedAccount: Equatable, Sendable {
    /// The stable profile identifier; also what scopes the per-profile local
    /// database (`CorePersistence.LocalDatabase`).
    public let uid: String
    public let displayName: String?
    public let emailAddress: String?
    /// Whether the address above has been confirmed. Meaningless — and never
    /// shown — when there is no address.
    public let isEmailVerified: Bool
    /// The raw provider identifiers the SDK reports, e.g. `google.com`.
    /// Kept raw rather than pre-mapped so an identifier this app does not
    /// recognise is not silently rewritten into one it does.
    public let providerIdentifiers: [String]

    public init(
        uid: String,
        displayName: String?,
        emailAddress: String?,
        isEmailVerified: Bool,
        providerIdentifiers: [String]
    ) {
        self.uid = uid
        self.displayName = displayName
        self.emailAddress = emailAddress
        self.isEmailVerified = isEmailVerified
        self.providerIdentifiers = providerIdentifiers
    }
}

/// The sign-in methods this application offers, as a type rather than as a
/// string comparison scattered across screens.
///
/// The identifiers are Firebase's, which is why the mapping lives in this
/// module: recognising `google.com` is adapter knowledge, and a screen that
/// performed the comparison itself would be one more place to update the day
/// a method is added.
///
/// An unrecognised identifier produces `nil` rather than a fallback case: this
/// app registers exactly three methods, so anything else is a state no screen
/// can honestly describe, and a screen that drops it says less rather than
/// something wrong.
public enum AuthenticationProvider: Equatable, Sendable, CaseIterable {
    case google
    case apple
    /// The emailed sign-in link. Firebase reports it as `password`, because
    /// the link and a password share one provider slot on the profile.
    case email

    public init?(providerIdentifier: String) {
        switch providerIdentifier {
        case "google.com": self = .google
        case "apple.com": self = .apple
        case "password", "emailLink": self = .email
        default: return nil
        }
    }
}
