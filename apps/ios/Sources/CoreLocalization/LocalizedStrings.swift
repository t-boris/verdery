import CoreDomain
import Foundation

/// Access to the application's localization catalogue.
///
/// The catalogue is a Core capability rather than a feature asset because the
/// same validation issue codes are surfaced by several features and must read
/// identically everywhere.
///
/// A locale is injected instead of read from the process so tests can assert
/// both catalogues, and so a future in-app language override does not have to
/// restart anything.
///
/// Source: architecture/ios-application-design.md, section "4. Application Structure".
public struct LocalizedStrings: Sendable {
    /// Languages the application ships. English is the development language.
    public static let supportedLanguageCodes = ["en", "ru"]

    private let bundle: Bundle
    private let locale: Locale

    public init(locale: Locale = .autoupdatingCurrent) {
        self.locale = locale
        self.bundle = Self.bundle(for: locale)
    }

    /// Resolves a key, returning the English text when a translation is missing.
    public func callAsFunction(_ key: LocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// Resolves an arbitrary key, used for codes that originate in Core.
    ///
    /// Returns the key itself when the catalogue has no entry, which is what
    /// makes a missing translation visible to a test instead of silently
    /// rendering blank.
    public func string(forKey key: String) -> String {
        bundle.localizedString(forKey: key, value: key, table: nil)
    }

    /// Renders a validation issue as user-facing text.
    ///
    /// Placeholders are named rather than positional because the contract names
    /// its parameters, and a translator reordering a sentence must not have to
    /// reason about argument order.
    public func message(for issue: ValidationIssue) -> String {
        var text = string(forKey: issue.code)

        for (name, parameter) in issue.parameters {
            text = text.replacingOccurrences(of: "{\(name)}", with: format(parameter))
        }

        return text
    }

    /// Substitutes named placeholders in a localized template.
    public func string(forKey key: String, parameters: [String: String]) -> String {
        var text = string(forKey: key)

        for (name, value) in parameters {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }

        return text
    }

    public func string(_ key: LocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    private func format(_ parameter: ValidationParameter) -> String {
        switch parameter {
        case let .text(value):
            return value
        case let .number(value):
            return Self.numberFormatter(for: locale).string(from: NSNumber(value: value))
                ?? String(value)
        }
    }

    /// Measurement values are formatted for the reader's locale, so a Russian
    /// reader sees `0,01` rather than `0.01`.
    private static func numberFormatter(for locale: Locale) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        // Three places matches the 1 mm storage grid; anything finer would be
        // false precision.
        formatter.maximumFractionDigits = GeometryTolerances.coordinateDecimalPlaces
        return formatter
    }

    /// Every key defined for a language.
    ///
    /// Exposed so that catalogue completeness — every language defining the same
    /// keys, and every validation code having an entry — is a test rather than a
    /// review habit.
    public static func keys(forLanguage code: String) -> Set<String>? {
        guard
            let path = Bundle.module.path(forResource: code, ofType: "lproj"),
            let localized = Bundle(path: path),
            let url = localized.url(forResource: "Localizable", withExtension: "strings"),
            let entries = NSDictionary(contentsOf: url) as? [String: String]
        else {
            return nil
        }

        return Set(entries.keys)
    }

    /// Guards `bundleCache` below. `Bundle(path:)` has no documented
    /// thread-safety guarantee for concurrent construction at the same path,
    /// and under Swift Testing's default parallel execution this package's
    /// much larger Phase 4 test suite now constructs dozens of
    /// `LocalizedStrings` instances at once. Added while investigating a
    /// nondeterministic SIGBUS crash during `swift test` on this development
    /// machine (never the same test, always before any test completes —
    /// consistent with a startup-time race, not any single test's logic).
    /// This closes one real, independently-justified race regardless of
    /// whether it was the actual cause: caching removes repeated concurrent
    /// `Bundle(path:)` construction entirely after the first resolution per
    /// language. See `apps/ios/README.md`'s "Known environment gap" note if
    /// the crash is still reproducible after this change — CI pins a
    /// specific Xcode/Swift toolchain (ADR-0009) that may not match this
    /// machine's own installation, so CI is the authoritative signal here,
    /// not a local repro.
    private static let bundleCacheLock = NSLock()
    nonisolated(unsafe) private static var bundleCache: [String: Bundle] = [:]

    /// Resolves the resource bundle for a locale.
    ///
    /// The package bundle already performs locale negotiation for the running
    /// process, but a test must be able to read a specific catalogue, so the
    /// matching `.lproj` is selected explicitly when one exists. Cached by
    /// language code after the first resolution — there are only ever two
    /// (`supportedLanguageCodes`), so the cache converges immediately and
    /// every `LocalizedStrings.init` after the first two, for either
    /// language, never touches `Bundle(path:)` again.
    private static func bundle(for locale: Locale) -> Bundle {
        guard let languageCode = locale.language.languageCode?.identifier else {
            return .module
        }

        bundleCacheLock.lock()
        defer { bundleCacheLock.unlock() }

        if let cached = bundleCache[languageCode] {
            return cached
        }

        let resolved: Bundle
        if let path = Bundle.module.path(forResource: languageCode, ofType: "lproj"),
            let localized = Bundle(path: path)
        {
            resolved = localized
        } else {
            resolved = .module
        }

        bundleCache[languageCode] = resolved
        return resolved
    }
}
