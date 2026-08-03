import CoreDesignSystem
import CoreDomain
import CoreLocalization
import Foundation

/// Display names for the observation domain's enums, and a pure
/// observed-at formatting rule — kept separate from the view model the same
/// way `MapCategoryLocalization` is kept separate from `MapEditorViewModel`.
public enum ObservationsLocalization {
    public static func key(for kind: ObservationCorrectionKind) -> LocalizationKey {
        switch kind {
        case .amendment: .observationsCorrectionKindAmendment
        case .supersede: .observationsCorrectionKindSupersede
        }
    }

    public static func correctionKindName(_ kind: ObservationCorrectionKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for kind: ImageAnalysisKind) -> LocalizationKey {
        switch kind {
        case .stress: .observationsAnalysisKindStress
        case .disease: .observationsAnalysisKindDisease
        case .pest: .observationsAnalysisKindPest
        case .other: .observationsAnalysisKindOther
        }
    }

    public static func analysisKindName(_ kind: ImageAnalysisKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for purpose: ObservationPhotoPurpose) -> ObservationJournalLocalizationKey {
        switch purpose {
        case .wholePlant: .observationsPhotoPurposeWholePlant
        case .leafFront: .observationsPhotoPurposeLeafFront
        case .leafBack: .observationsPhotoPurposeLeafBack
        case .stemOrBark: .observationsPhotoPurposeStemOrBark
        case .flower: .observationsPhotoPurposeFlower
        case .fruit: .observationsPhotoPurposeFruit
        case .symptomCloseUp: .observationsPhotoPurposeSymptomCloseUp
        case .contextOrFreeForm: .observationsPhotoPurposeContextOrFreeForm
        }
    }

    public static func photoPurposeName(_ purpose: ObservationPhotoPurpose, strings: LocalizedStrings) -> String {
        strings(key(for: purpose))
    }

    public static func key(for kind: ObservationMeasurementKind) -> ObservationJournalLocalizationKey {
        switch kind {
        case .height: .observationsMeasurementKindHeight
        case .width: .observationsMeasurementKindWidth
        case .count: .observationsMeasurementKindCount
        }
    }

    public static func key(for kind: ObservationSymptomKind) -> ObservationJournalLocalizationKey {
        switch kind {
        case .leafSpots: .observationsSymptomLeafSpots
        case .leafYellowing: .observationsSymptomLeafYellowing
        case .leafCurling: .observationsSymptomLeafCurling
        case .wilting: .observationsSymptomWilting
        case .holesOrChewing: .observationsSymptomHolesOrChewing
        case .mouldOrMildew: .observationsSymptomMouldOrMildew
        case .dieback: .observationsSymptomDieback
        case .stuntedGrowth: .observationsSymptomStuntedGrowth
        case .unusualGrowth: .observationsSymptomUnusualGrowth
        }
    }

    public static func symptomKindName(
        _ kind: ObservationSymptomKind,
        strings: LocalizedStrings
    ) -> String {
        strings(key(for: kind))
    }

    public static func key(
        for severity: ObservationSymptomSeverity
    ) -> ObservationJournalLocalizationKey {
        switch severity {
        case .mild: .observationsSeverityMild
        case .moderate: .observationsSeverityModerate
        case .severe: .observationsSeveritySevere
        }
    }

    public static func symptomSeverityName(
        _ severity: ObservationSymptomSeverity,
        strings: LocalizedStrings
    ) -> String {
        strings(key(for: severity))
    }

    public static func measurementKindName(
        _ kind: ObservationMeasurementKind,
        strings: LocalizedStrings
    ) -> String {
        strings(key(for: kind))
    }

    /// Not a stored `static let`: `DateFormatter` is not `Sendable` — the
    /// same reason `CalendarDate.swift` computes its formatter fresh.
    public static func formattedObservedAt(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }

    public static func key(for safetyClass: HealthSuggestionSafetyClass) -> ObservationsHealthSuggestionLocalizationKey {
        switch safetyClass {
        case .informational: .observationsSafetyClassInformational
        case .monitor: .observationsSafetyClassMonitor
        case .expertReviewRecommended: .observationsSafetyClassExpertReviewRecommended
        }
    }

    public static func safetyClassName(_ safetyClass: HealthSuggestionSafetyClass, strings: LocalizedStrings) -> String {
        strings(key(for: safetyClass))
    }

    /// `expertReviewRecommended` reads as the most urgent tone available
    /// (`.negative`, not a literal error); `monitor`/`informational` both
    /// read as `.neutral`, never `.positive` — an AI suggestion is never a
    /// confirmed good result. Mirrors `apps/web/features/observations/
    /// labels.ts`'s `safetyClassTone`.
    public static func tone(for safetyClass: HealthSuggestionSafetyClass) -> Tone {
        switch safetyClass {
        case .informational, .monitor: .neutral
        case .expertReviewRecommended: .negative
        }
    }

    public static func key(for disposition: HealthSuggestionDisposition) -> ObservationsHealthSuggestionLocalizationKey {
        switch disposition {
        case .unresolved: .observationsDispositionUnresolved
        case .confirmedExternally: .observationsDispositionConfirmedExternally
        case .acceptedAsObservation: .observationsDispositionAcceptedAsObservation
        case .rejected: .observationsDispositionRejected
        }
    }

    public static func dispositionName(_ disposition: HealthSuggestionDisposition, strings: LocalizedStrings) -> String {
        strings(key(for: disposition))
    }
}
