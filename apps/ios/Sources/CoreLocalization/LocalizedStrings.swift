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

    /// The same resolution for the account screen's own key set.
    ///
    /// An overload rather than a generic or an existential parameter, because
    /// only a concrete parameter type keeps `strings(.profileTitle)` working:
    /// leading-dot syntax needs a contextual type, and the compiler considers
    /// every overload when it looks the member up. See
    /// ``ProfileLocalizationKey`` for why there is a second key set at all.
    public func callAsFunction(_ key: ProfileLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the task-assignment/activity screens' own key
    /// set. See ``TaskCollaborationLocalizationKey`` for why this is a third
    /// key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: TaskCollaborationLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the Collaborators/ownership-transfer/accept-
    /// invitation key set (P9A-IOS-01). See ``CollaborationLocalizationKey``
    /// for why this is yet another key set rather than more cases somewhere
    /// existing.
    public func callAsFunction(_ key: CollaborationLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the Seasonal plan screen's own key set
    /// (P9D-UX-01). See ``SeasonalPlanLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: SeasonalPlanLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the taxon catalog profile's own key set
    /// (P11-IOS-01). See ``TaxonProfileLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: TaxonProfileLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the visual plant journal's own key set
    /// (P11-MEDIA-01). See ``ObservationJournalLocalizationKey`` for why this
    /// is yet another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: ObservationJournalLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the Context quality screen's own key set
    /// (P9D-UX-01). See ``GardenContextLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: GardenContextLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the "Add plant from photo"/pending-
    /// identification key set (ADR-0015's client wiring). See
    /// ``PlantIdentificationLocalizationKey`` for why this is yet another key
    /// set rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantIdentificationLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the live camera-capture affordance's own key
    /// set, shared across every photo-attach point. See
    /// ``MediaCaptureLocalizationKey`` for why this is yet another key set
    /// rather than more cases somewhere existing.
    public func callAsFunction(_ key: MediaCaptureLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the browsable plant-inventory list screen's
    /// own key set. See ``PlantsListLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantsListLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the map-object picker sheet's own key set.
    /// See ``PlantMapObjectPickerLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantMapObjectPickerLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the plant detail screen's photo gallery
    /// section. See ``PlantPhotoGalleryLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantPhotoGalleryLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the observation timeline's health-suggestion
    /// review key set (P11-HEALTH-01). See
    /// ``ObservationsHealthSuggestionLocalizationKey`` for why this is yet
    /// another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: ObservationsHealthSuggestionLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the plant-candidates feature's own key set
    /// (P11-IOS-01). See ``PlantCandidatesLocalizationKey`` for why this is
    /// yet another key set rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantCandidatesLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the console status strip's own key set. See
    /// ``SyncStatusLocalizationKey`` for why this is yet another key set
    /// rather than more cases somewhere existing.
    public func callAsFunction(_ key: SyncStatusLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the plant-label sheet's own key set. See
    /// ``PlantLabelLocalizationKey`` for why this is yet another key set
    /// rather than more cases somewhere existing.
    public func callAsFunction(_ key: PlantLabelLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the account-deletion screen's own key set. See
    /// ``DeleteAccountLocalizationKey`` for why this is yet another key set
    /// rather than more cases somewhere existing.
    public func callAsFunction(_ key: DeleteAccountLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the data-export screen's own key set. See
    /// ``ExportLocalizationKey`` for why this is yet another key set rather
    /// than more cases somewhere existing.
    public func callAsFunction(_ key: ExportLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the conditions panel and a plant's care card.
    /// See ``WeatherLocalizationKey`` for why this is yet another key set.
    public func callAsFunction(_ key: WeatherLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same parameterized resolution for ``WeatherLocalizationKey``'s
    /// templated entries (a measurement value, a rainfall day, a window).
    public func string(_ key: WeatherLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same resolution for the notification inbox and its preferences.
    /// See ``NotificationLocalizationKey`` for why this is yet another key set.
    public func callAsFunction(_ key: NotificationLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same parameterized resolution for ``NotificationLocalizationKey``'s
    /// templated entries (a rendered template body, a quiet window).
    public func string(_ key: NotificationLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same resolution for the identification review stack and the
    /// capture-run summary. See ``IdentificationReviewLocalizationKey``.
    public func callAsFunction(_ key: IdentificationReviewLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same parameterized resolution for that key set's templated entries
    /// (a remaining count, a confidence percentage).
    public func string(
        _ key: IdentificationReviewLocalizationKey,
        parameters: [String: String]
    ) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same resolution for the plat reading and aerial tracing screens.
    public func callAsFunction(_ key: PlatReadingLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same parameterized resolution for that key set's templated entries
    /// (an area, a closure error, one boundary call).
    public func string(_ key: PlatReadingLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same resolution for the calibration bar's measurement controls.
    public func callAsFunction(_ key: MapCalibrationLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the date dial's relative shortcuts.
    public func callAsFunction(_ key: RelativeDayLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same resolution for the georeference screen's own key set. See
    /// ``GeoreferenceLocalizationKey`` for why this is yet another key set.
    public func callAsFunction(_ key: GeoreferenceLocalizationKey) -> String {
        string(forKey: key.rawValue)
    }

    /// The same parameterized resolution for ``GeoreferenceLocalizationKey``'s
    /// templated entries (a coordinate pair, a rotation, an accuracy).
    public func string(_ key: GeoreferenceLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// Every key any of the application's key sets declares.
    ///
    /// Exposed so catalogue completeness stays one check over one list rather
    /// than a test that has to remember each key set — the failure mode a
    /// second key set could otherwise introduce.
    public static let declaredKeys: [String] =
        LocalizationKey.allCases.map(\.rawValue)
        + ProfileLocalizationKey.allCases.map(\.rawValue)
        + TaskCollaborationLocalizationKey.allCases.map(\.rawValue)
        + CollaborationLocalizationKey.allCases.map(\.rawValue)
        + SeasonalPlanLocalizationKey.allCases.map(\.rawValue)
        + GardenContextLocalizationKey.allCases.map(\.rawValue)
        + PlantIdentificationLocalizationKey.allCases.map(\.rawValue)
        + MediaCaptureLocalizationKey.allCases.map(\.rawValue)
        + PlantsListLocalizationKey.allCases.map(\.rawValue)
        + PlantMapObjectPickerLocalizationKey.allCases.map(\.rawValue)
        + PlantPhotoGalleryLocalizationKey.allCases.map(\.rawValue)
        + ObservationsHealthSuggestionLocalizationKey.allCases.map(\.rawValue)
        + PlantCandidatesLocalizationKey.allCases.map(\.rawValue)
        + ObservationJournalLocalizationKey.allCases.map(\.rawValue)
        + TaxonProfileLocalizationKey.allCases.map(\.rawValue)
        + SyncStatusLocalizationKey.allCases.map(\.rawValue)
        + PlantLabelLocalizationKey.allCases.map(\.rawValue)
        + DeleteAccountLocalizationKey.allCases.map(\.rawValue)
        + ExportLocalizationKey.allCases.map(\.rawValue)
        + WeatherLocalizationKey.allCases.map(\.rawValue)
        + NotificationLocalizationKey.allCases.map(\.rawValue)
        + GeoreferenceLocalizationKey.allCases.map(\.rawValue)
        + RelativeDayLocalizationKey.allCases.map(\.rawValue)
        + IdentificationReviewLocalizationKey.allCases.map(\.rawValue)
        + MapCalibrationLocalizationKey.allCases.map(\.rawValue)
        + PlatReadingLocalizationKey.allCases.map(\.rawValue)

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

    /// The same parameterized resolution for
    /// ``TaskCollaborationLocalizationKey``'s own templated entries (an
    /// activity row naming who acted, and who was assigned).
    public func string(_ key: TaskCollaborationLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same parameterized resolution for
    /// ``CollaborationLocalizationKey``'s own templated entries (a role
    /// named in a confirmation prompt, a garden named in an accept-
    /// invitation or ownership-transfer message, a share link embedded in
    /// invite/transfer share text).
    public func string(_ key: CollaborationLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same parameterized resolution for ``SeasonalPlanLocalizationKey``'s
    /// own templated entries (a month range, a rotation-conflict sentence
    /// naming family/priorFamily/elapsedDays/restPeriodThresholdDays, the raw
    /// plant-id fallback).
    public func string(_ key: SeasonalPlanLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same parameterized resolution for ``GardenContextLocalizationKey``'s
    /// own templated entries (a recorded-by profile id, a reviewed-by/on pair).
    public func string(_ key: GardenContextLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same parameterized resolution for
    /// ``ObservationsHealthSuggestionLocalizationKey``'s own templated
    /// entries (the evidence summary text, the disposition reviewed-at date).
    public func string(_ key: ObservationsHealthSuggestionLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// The same parameterized resolution for
    /// ``PlantCandidatesLocalizationKey``'s own templated entry (a
    /// suitability finding's assumed value).
    public func string(_ key: PlantCandidatesLocalizationKey, parameters: [String: String]) -> String {
        string(forKey: key.rawValue, parameters: parameters)
    }

    /// Formats a number with a fixed number of fraction digits, in the
    /// reader's locale.
    ///
    /// `String(format: "%.1f", …)` always emits the POSIX decimal separator,
    /// so a Russian reader saw `1.5` inside otherwise-Russian prose. The
    /// digit count stays an explicit argument because a measurement figure
    /// must never show more digits than the estimate behind it supports —
    /// that decision belongs to the caller.
    public func number(_ value: Double, fractionDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
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
