import SwiftUI

/// Physical confirmation for a commit the reader cannot otherwise feel.
///
/// Used only where something durable happened — a task completed, a record
/// saved, a destructive action carried out — never for navigation or for
/// selection, where the tap itself is already the feedback and an extra buzz
/// reads as noise.
///
/// `#if canImport(UIKit)`: this package also builds for macOS headlessly, and
/// there is no haptic engine there to call.
public enum Haptics {
    public enum Kind: Sendable {
        case success
        case warning
        case failure
        case selection
    }

    @MainActor
    public static func play(_ kind: Kind) {
        #if canImport(UIKit)
        switch kind {
        case .success:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .failure:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .selection:
            UISelectionFeedbackGenerator().selectionChanged()
        }
        #endif
    }
}
