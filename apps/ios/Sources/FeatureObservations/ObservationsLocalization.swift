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

    /// Not a stored `static let`: `DateFormatter` is not `Sendable` — the
    /// same reason `CalendarDate.swift` computes its formatter fresh.
    public static func formattedObservedAt(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }
}
