import CoreDesignSystem
import CoreLocalization
import Foundation

/// The edit section's own wording — split from the view model's body so that
/// file stays under this repository's 600-line rule, the same seam
/// `PlantDetailView+Editing.swift` already draws in the view.
extension PlantDetailViewModel {
    public var quantityUnitLabel: String { strings(.plantsQuantityUnit) }
    public var quantityIncreaseLabel: String { strings(.plantsQuantityIncrease) }
    public var quantityDecreaseLabel: String { strings(.plantsQuantityDecrease) }

    /// The date dial's four shortcuts, as words rather than as dates. They were
    /// previously rendered with the date formatter, so "Today" appeared as the
    /// very date the caption beneath it already carried.
    public func relativeDayTitle(_ kind: RelativeDayOption.Kind) -> String {
        switch kind {
        case .today: strings(.relativeDayToday)
        case .tomorrow: strings(.relativeDayTomorrow)
        case .thisWeekend: strings(.relativeDayThisWeekend)
        case .nextWeek: strings(.relativeDayNextWeek)
        }
    }
}
