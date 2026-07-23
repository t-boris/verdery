import CoreDomain
import CoreLocalization

/// Display names for the task domain's enums — kept separate from the view
/// model the same way `MapCategoryLocalization` is kept separate from
/// `MapEditorViewModel`.
public enum TasksLocalization {
    public static func key(for kind: TaskTargetKind) -> LocalizationKey {
        switch kind {
        case .garden: .tasksTargetKindGarden
        case .gardenArea: .tasksTargetKindGardenArea
        case .plant: .tasksTargetKindPlant
        }
    }

    public static func targetKindName(_ kind: TaskTargetKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for status: TaskStatus) -> LocalizationKey {
        switch status {
        case .planned: .tasksStatusPlanned
        case .suggested: .tasksStatusSuggested
        case .completed: .tasksStatusCompleted
        case .skipped: .tasksStatusSkipped
        case .dismissed: .tasksStatusDismissed
        case .deleted: .tasksStatusDeleted
        }
    }

    public static func statusName(_ status: TaskStatus, strings: LocalizedStrings) -> String {
        strings(key(for: status))
    }

    public static func key(for urgency: TaskUrgency) -> LocalizationKey {
        switch urgency {
        case .low: .tasksUrgencyLow
        case .normal: .tasksUrgencyNormal
        case .high: .tasksUrgencyHigh
        case .urgent: .tasksUrgencyUrgent
        }
    }

    public static func urgencyName(_ urgency: TaskUrgency, strings: LocalizedStrings) -> String {
        strings(key(for: urgency))
    }
}
