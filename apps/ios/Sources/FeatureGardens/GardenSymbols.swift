import CoreDesignSystem
import CoreDomain

/// Which SF Symbol and which tone stand for each garden state.
///
/// One table rather than a symbol name typed at each call site, so the garden
/// list, the settings sheet, and anything added later cannot drift into
/// showing the same state three different ways. SF Symbols are used throughout
/// because they are already drawn for every weight, already scale with Dynamic
/// Type, and already carry a system-provided accessible name — none of which a
/// bundled image would.
///
/// A symbol never travels alone: every call site pairs it with the localized
/// label from the view model, because a symbol is a fast way to recognize a
/// state you already know and a poor way to learn one you do not.
enum GardenSymbols {
    static func lifecycle(_ state: GardenLifecycleState) -> String {
        switch state {
        case .active: "leaf.fill"
        case .archived: "archivebox.fill"
        case .deletionRequested: "trash.fill"
        }
    }

    static func lifecycleTone(_ state: GardenLifecycleState) -> Tone {
        switch state {
        case .active: .positive
        case .archived: .neutral
        case .deletionRequested: .negative
        }
    }

    static func role(_ role: GardenRole) -> String {
        switch role {
        case .owner: "key.fill"
        case .editor: "pencil"
        case .viewer: "eye.fill"
        }
    }

    /// The marker for a record that is saved on this device but has not yet
    /// been confirmed by the server.
    static let pendingSync = "arrow.triangle.2.circlepath"
}
