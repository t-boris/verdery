import CoreDesignSystem
import CoreDomain

/// Which SF Symbol and which tone stand for each collaboration concept — the
/// same one-table-per-domain pattern as `GardenSymbols`/`TaskSymbols`.
enum CollaborationSymbols {
    static let invite = "person.badge.plus"
    static let member = "person.fill"
    static let pendingInvitation = "envelope.badge.clock"
    static let revoke = "xmark.circle"
    static let promote = "arrow.up.circle"
    static let demote = "arrow.down.circle"
    static let remove = "person.crop.circle.badge.minus"
    static let ownershipTransfer = "person.2.badge.gearshape"
    static let share = "square.and.arrow.up"

    static func invitationState(_ state: GardenInvitationState) -> String {
        switch state {
        case .pending: "clock.fill"
        case .accepted: "checkmark.circle.fill"
        case .revoked: "xmark.circle.fill"
        case .expired: "hourglass"
        }
    }

    static func invitationStateTone(_ state: GardenInvitationState) -> Tone {
        switch state {
        case .pending: .warning
        case .accepted: .positive
        case .revoked: .negative
        case .expired: .neutral
        }
    }
}
