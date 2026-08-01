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

        #expect(Set(LocalizedStrings.declaredKeys).isSubset(of: english))
    }

    /// The application declares its keys across more than one enum — see
    /// `ProfileLocalizationKey` for why — so a key set that was added and never
    /// added to `declaredKeys` would silently escape every check in this suite.
    @Test("Every declared key set is included in the list the checks run over")
    func declarationListIsComplete() {
        let declared = Set(LocalizedStrings.declaredKeys)

        #expect(Set(LocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(ProfileLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(TaskCollaborationLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(CollaborationLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(PlantIdentificationLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(MediaCaptureLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(ObservationsHealthSuggestionLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(Set(PlantCandidatesLocalizationKey.allCases.map(\.rawValue)).isSubset(of: declared))
        #expect(declared.count == LocalizedStrings.declaredKeys.count, "A key is declared twice.")
    }

    /// Both catalogues must translate; a Russian entry left holding the
    /// English sentence is a missing translation that every other check here
    /// passes, because the key *is* present in both files.
    @Test("No Russian entry is still the English text")
    func russianIsActuallyTranslated() throws {
        let english = LocalizedStrings(locale: Locale(identifier: "en_GB"))
        let russian = LocalizedStrings(locale: Locale(identifier: "ru_RU"))

        var identical: Set<String> = []
        for key in LocalizedStrings.declaredKeys {
            let englishText = english.string(forKey: key)
            guard englishText == russian.string(forKey: key) else { continue }
            // Strip placeholders before asking whether prose remains.
            var prose = englishText
            while let start = prose.firstIndex(of: "{"), let end = prose.firstIndex(of: "}"),
                start < end
            {
                prose.removeSubrange(start...end)
            }
            if prose.range(of: "[A-Za-z]{4}", options: .regularExpression) != nil {
                identical.insert(key)
            }
        }

        // Every entry in this catalogue is genuinely translated today. A
        // future key that is legitimately identical in both languages — a
        // brand name, say — belongs in an explicit allowlist here rather
        // than in a weakened assertion.
        #expect(identical.isEmpty, "Untranslated Russian entries: \(identical.sorted())")
    }

    /// A placeholder present in one language and absent in the other renders
    /// as a literal `{value}` on screen for the reader of that language.
    @Test("Both languages declare the same interpolation placeholders")
    func placeholdersAgree() {
        let english = LocalizedStrings(locale: Locale(identifier: "en_GB"))
        let russian = LocalizedStrings(locale: Locale(identifier: "ru_RU"))

        func placeholders(_ template: String) -> Set<String> {
            let pattern = try? NSRegularExpression(pattern: #"\{(\w+)\}"#)
            let range = NSRange(template.startIndex..<template.endIndex, in: template)
            let matches = pattern?.matches(in: template, range: range) ?? []
            return Set(
                matches.compactMap { match in
                    Range(match.range(at: 1), in: template).map { String(template[$0]) }
                }
            )
        }

        for key in LocalizedStrings.declaredKeys {
            #expect(
                placeholders(english.string(forKey: key))
                    == placeholders(russian.string(forKey: key)),
                "\(key) declares different placeholders in each language."
            )
        }
    }

    @Test("The catalogue has no entry that nothing refers to")
    func catalogueHasNoOrphans() throws {
        let english = try #require(LocalizedStrings.keys(forLanguage: "en"))
        let declared = Set(LocalizedStrings.declaredKeys)
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
