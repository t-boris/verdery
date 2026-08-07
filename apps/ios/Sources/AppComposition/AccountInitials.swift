import Foundation

/// The one or two letters that stand in for a person in the console strip.
///
/// A stand-in rather than a photograph: this application has no avatar upload,
/// and inventing one to fill a 24-point circle would be a feature nobody asked
/// for. Initials answer the only question the strip needs to — *whose* garden
/// am I looking at — in a space where a name does not fit.
///
/// Pure and locale-aware, so it can be asserted rather than eyeballed:
/// uppercasing is not the same operation in every language, and a name in a
/// script with no case must still produce something rather than nothing.
public enum AccountInitials {
    /// - Parameters:
    ///   - displayName: the provider's name for this person, when it gave one.
    ///   - emailAddress: the fallback, since every sign-in path has one.
    ///   - locale: decides how the letters are uppercased.
    ///   - fallback: what to show when neither source yields a letter — a
    ///     person signed in with no name and an address that begins with a
    ///     digit still needs a button they can find.
    public static func from(
        displayName: String?,
        emailAddress: String?,
        locale: Locale,
        fallback: String = "•"
    ) -> String {
        if let initials = fromName(displayName, locale: locale) { return initials }
        if let initials = fromEmail(emailAddress, locale: locale) { return initials }
        return fallback
    }

    /// First letters of the first and last word — "Ada Lovelace" is AL,
    /// "Ada" is A. Middle names are skipped rather than crowding the circle.
    private static func fromName(_ name: String?, locale: Locale) -> String? {
        guard let name else { return nil }
        let words = name
            .split(whereSeparator: \.isWhitespace)
            .filter { $0.contains(where: \.isLetter) }
        guard let first = words.first else { return nil }

        var letters = String(first.prefix(1))
        if words.count > 1, let last = words.last {
            letters += String(last.prefix(1))
        }
        return letters.uppercased(with: locale)
    }

    /// The first letter of the local part. Anything after `@` is a company,
    /// not a person.
    private static func fromEmail(_ email: String?, locale: Locale) -> String? {
        guard let email else { return nil }
        let localPart = email.split(separator: "@").first ?? ""
        guard let letter = localPart.first(where: \.isLetter) else { return nil }
        return String(letter).uppercased(with: locale)
    }
}
