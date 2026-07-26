/// Keys the account screen resolves against the localization catalogue.
///
/// A second enum rather than more cases in ``LocalizationKey``, for a reason
/// that is structural rather than stylistic: an enum's cases cannot be
/// declared in an extension, so a single enum is necessarily a single file —
/// and that file sits at exactly the 600-line ceiling this repository enforces
/// (`scripts/check-file-size.mjs`). Splitting it is therefore the only way to
/// add a key at all, and splitting an enum means a second enum.
///
/// This is a file boundary, not a second source of truth. Both enums resolve
/// through the same ``LocalizedStrings`` against the same catalogue, and
/// `Tests/CoreLocalizationTests` covers both together: every declared key must
/// have an entry in both languages, and every entry must be declared by one of
/// them. Nothing about a key changes by living here.
///
/// The natural seam is a feature's own keys, which is what this is. Moving the
/// remaining feature blocks out of ``LocalizationKey`` the same way is a purely
/// mechanical follow-up — call sites are unaffected, because leading-dot syntax
/// resolves across `LocalizedStrings`' overloads — and is deliberately not done
/// here, where it would be a large unrelated diff.
public enum ProfileLocalizationKey: String, Sendable, CaseIterable {
    case profileTitle = "profile.title"
    case profileSignedIn = "profile.signedIn"
    case profileSectionAbout = "profile.section.about"
    case profileEmailVerified = "profile.email.verified"
    case profileEmailUnverified = "profile.email.unverified"
    case profileProviderGoogle = "profile.provider.google"
    case profileProviderApple = "profile.provider.apple"
    case profileProviderEmail = "profile.provider.email"
    case profileAppVersion = "profile.app.version"
    case profileAppBuild = "profile.app.build"
    case profileAppLanguage = "profile.app.language"
    case profileSignOutConfirmTitle = "profile.signOut.confirm.title"
    case profileSignOutConfirmMessage = "profile.signOut.confirm.message"
    case profileSignOutCancel = "profile.signOut.cancel"
    case profileSignOutFailed = "profile.signOut.failed"
}
