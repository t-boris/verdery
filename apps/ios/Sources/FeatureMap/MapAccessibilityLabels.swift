import CoreDomain
import Foundation

/// One row of the accessible object list — the real VoiceOver-navigable
/// alternative to tapping a shape on the canvas, not a decorative summary of
/// it. Selecting a row selects the same object a canvas tap would; the
/// accessibility label is the primary way a VoiceOver user learns what an
/// object is, so it carries category and state, not just a name.
public struct MapAccessibleObjectRow: Equatable, Sendable, Identifiable {
    public let id: String
    /// What the row's visible title shows: the object's label, or a fallback
    /// when it has none.
    public let title: String
    /// The full VoiceOver label: category, title, and — critically — a
    /// spoken lifecycle indicator rather than a colour, satisfying "non-color
    /// state indicators" for the one state (deleted, pending restore) this
    /// list can show that the canvas does not.
    public let accessibilityLabel: String
    public let isDeleted: Bool

    public init(id: String, title: String, accessibilityLabel: String, isDeleted: Bool) {
        self.id = id
        self.title = title
        self.accessibilityLabel = accessibilityLabel
        self.isDeleted = isDeleted
    }
}

/// Pure construction of accessible list rows and their VoiceOver labels.
///
/// Kept independent of `CoreLocalization` and `SwiftUI`: every localized
/// fragment (category name, "deleted" suffix, the untitled fallback) is
/// resolved by the caller and passed in as plain text, so this file is
/// testable with fixture strings and never has to load a resource bundle to
/// prove its sentence assembly is correct.
public enum MapAccessibilityLabels {
    public static func row(
        for object: GardenMapObject,
        categoryName: String,
        untitledFallback: String,
        deletedSuffix: String
    ) -> MapAccessibleObjectRow {
        let trimmedLabel = object.label?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (trimmedLabel?.isEmpty == false) ? trimmedLabel! : untitledFallback
        let isDeleted = object.lifecycleState == .deleted

        var accessibilityLabel = "\(categoryName), \(title)"
        if isDeleted {
            accessibilityLabel += ", \(deletedSuffix)"
        }

        return MapAccessibleObjectRow(
            id: object.id,
            title: title,
            accessibilityLabel: accessibilityLabel,
            isDeleted: isDeleted
        )
    }
}
