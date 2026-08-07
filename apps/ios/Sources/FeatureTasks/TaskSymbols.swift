import CoreDesignSystem
import CoreDomain

/// Which SF Symbol and tone stand for each task status, urgency, and target.
///
/// The urgency table is deliberately identical to
/// `FeatureRecommendations.TodaySymbols.urgency` — see that type's own comment
/// for why the two are duplicated rather than shared.
enum TaskSymbols {
    static func status(_ status: TaskStatus) -> String {
        switch status {
        case .planned: "circle"
        case .suggested: "sparkles"
        case .completed: "checkmark.circle.fill"
        case .skipped: "arrow.uturn.forward.circle.fill"
        case .dismissed: "xmark.circle.fill"
        case .deleted: "trash.circle.fill"
        }
    }

    static func statusTone(_ status: TaskStatus) -> Tone {
        switch status {
        case .planned: .neutral
        case .suggested: .neutral
        case .completed: .positive
        case .skipped, .dismissed: .neutral
        case .deleted: .negative
        }
    }

    static func urgency(_ urgency: TaskUrgency) -> String {
        switch urgency {
        case .low: "tortoise.fill"
        case .normal: "circle.fill"
        case .high: "exclamationmark.2"
        case .urgent: "flame.fill"
        }
    }

    static func urgencyTone(_ urgency: TaskUrgency) -> Tone {
        switch urgency {
        case .low: .neutral
        case .normal: .neutral
        case .high: .warning
        case .urgent: .negative
        }
    }

    static func targetKind(_ kind: TaskTargetKind) -> String {
        switch kind {
        case .garden: "tree.fill"
        case .gardenArea: "square.dashed"
        case .plant: "leaf.fill"
        }
    }

    static let dueDate = "calendar"
    static let timeWindow = "clock"
    static let complete = "checkmark"
    static let skip = "arrow.uturn.forward"
    static let dismiss = "xmark"
    static let delete = "trash"
    static let edit = "pencil"
    static let reschedule = "calendar.badge.clock"
    static let pendingSync = "arrow.triangle.2.circlepath"
    static let assign = "person.crop.circle.badge.plus"
    static let activity = "clock.arrow.circlepath"
}
