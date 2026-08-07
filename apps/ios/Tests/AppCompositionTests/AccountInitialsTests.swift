import Foundation
import Testing

@testable import AppComposition

/// The letters that stand in for a person in a 24-point circle.
///
/// Small, and worth pinning: this runs for every signed-in reader on every
/// screen, and the ways it can be wrong — an empty circle, a lowercase letter,
/// a name in a script with no case — are all silent.
@Suite("Account initials")
struct AccountInitialsTests {
    private let en = Locale(identifier: "en_US")
    private let ru = Locale(identifier: "ru_RU")

    @Test("takes the first and last word, skipping what is in between")
    func firstAndLast() {
        #expect(
            AccountInitials.from(
                displayName: "Ada Lovelace", emailAddress: nil, locale: en
            ) == "AL"
        )
        #expect(
            AccountInitials.from(
                displayName: "Ada King Lovelace", emailAddress: nil, locale: en
            ) == "AL"
        )
        #expect(
            AccountInitials.from(displayName: "Ada", emailAddress: nil, locale: en) == "A"
        )
    }

    @Test("works in a non-Latin script")
    func cyrillic() {
        #expect(
            AccountInitials.from(
                displayName: "Борис Цекиновский", emailAddress: nil, locale: ru
            ) == "БЦ"
        )
    }

    /// Every sign-in path yields an address even when the provider gives no
    /// name, so the circle is never empty for a real account.
    @Test("falls back to the address, and reads only its local part")
    func fallsBackToEmail() {
        #expect(
            AccountInitials.from(
                displayName: nil, emailAddress: "ada@example.com", locale: en
            ) == "A"
        )
        // The domain is a company, not a person: an address whose local part
        // starts with a digit must not silently become "E" for Example.
        #expect(
            AccountInitials.from(
                displayName: nil, emailAddress: "42@example.com", locale: en
            ) == "•"
        )
    }

    /// A name that is only punctuation or whitespace is not a name.
    @Test("shows a placeholder rather than nothing at all")
    func placeholderWhenNothingUsable() {
        #expect(AccountInitials.from(displayName: "   ", emailAddress: nil, locale: en) == "•")
        #expect(AccountInitials.from(displayName: nil, emailAddress: nil, locale: en) == "•")
        #expect(AccountInitials.from(displayName: "!!", emailAddress: nil, locale: en) == "•")
    }

    @Test("uppercases what it finds")
    func uppercases() {
        #expect(
            AccountInitials.from(
                displayName: "ada lovelace", emailAddress: nil, locale: en
            ) == "AL"
        )
    }
}
