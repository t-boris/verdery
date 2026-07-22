import CoreDomain
import Foundation
import Testing

@testable import CoreLocalization

@Suite("Localization catalogue")
struct LocalizationCatalogueTests {
    @Test("Every shipped language is present", arguments: LocalizedStrings.supportedLanguageCodes)
    func languageIsPresent(_ code: String) throws {
        let keys = try #require(LocalizedStrings.keys(forLanguage: code))

        #expect(!keys.isEmpty)
    }

    /// A key present in one language and missing in another renders as its own
    /// identifier on screen, which reviewers rarely notice. The catalogue is
    /// therefore compared as a set rather than read.
    @Test("Every language defines the same keys")
    func languagesAgree() throws {
        let english = try #require(LocalizedStrings.keys(forLanguage: "en"))

        for code in LocalizedStrings.supportedLanguageCodes where code != "en" {
            #expect(try #require(LocalizedStrings.keys(forLanguage: code)) == english)
        }
    }

    @Test("Every validation code has an entry")
    func validationCodesAreCovered() throws {
        let english = try #require(LocalizedStrings.keys(forLanguage: "en"))

        #expect(Set(GeometryValidationCode.all).isSubset(of: english))
    }

    @Test("Every declared key has an entry")
    func declaredKeysAreCovered() throws {
        let english = try #require(LocalizedStrings.keys(forLanguage: "en"))

        #expect(Set(LocalizationKey.allCases.map(\.rawValue)).isSubset(of: english))
    }

    @Test("The catalogue has no entry that nothing refers to")
    func catalogueHasNoOrphans() throws {
        let english = try #require(LocalizedStrings.keys(forLanguage: "en"))
        let declared = Set(LocalizationKey.allCases.map(\.rawValue))
            .union(GeometryValidationCode.all)

        #expect(english.subtracting(declared).isEmpty)
    }
}

@Suite("Localized strings")
struct LocalizedStringsTests {
    @Test("Resolves a key in each language")
    func resolvesPerLanguage() {
        let english = LocalizedStrings(locale: Locale(identifier: "en_GB"))
        let russian = LocalizedStrings(locale: Locale(identifier: "ru_RU"))

        #expect(english(.healthActionRefresh) == "Check again")
        #expect(russian(.healthActionRefresh) == "Проверить снова")
    }

    @Test("An unknown key resolves to itself so the gap is visible")
    func surfacesMissingKeys() {
        let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

        #expect(strings.string(forKey: "does.not.exist") == "does.not.exist")
    }

    @Test("Named parameters are interpolated into the localized message")
    func interpolatesValidationParameters() {
        let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))
        let issue = ValidationIssue(
            code: GeometryValidationCode.polygonTooFewVertices,
            severity: .error,
            parameters: ["minimum": .number(4), "actual": .number(3)]
        )

        #expect(strings.message(for: issue) == "An area needs at least 4 corners.")
    }

    /// Measurements are formatted for the reader, so a Russian reader sees a
    /// decimal comma rather than a point.
    @Test("Numbers are formatted for the reader's locale")
    func formatsNumbersForLocale() {
        let strings = LocalizedStrings(locale: Locale(identifier: "ru_RU"))
        let issue = ValidationIssue(
            code: GeometryValidationCode.polygonBelowMinimumArea,
            severity: .error,
            parameters: ["minimumSquareMetres": .number(0.01)]
        )

        #expect(strings.message(for: issue).contains("0,01"))
    }

    @Test("A localized message never leaves a placeholder behind")
    func leavesNoPlaceholders() {
        for locale in [Locale(identifier: "en_GB"), Locale(identifier: "ru_RU")] {
            let strings = LocalizedStrings(locale: locale)

            let issue = ValidationIssue(
                code: GeometryValidationCode.coordinateOutOfRange,
                severity: .error,
                parameters: ["value": .number(20000), "limitMetres": .number(10000)]
            )

            #expect(!strings.message(for: issue).contains("{"))
        }
    }
}
