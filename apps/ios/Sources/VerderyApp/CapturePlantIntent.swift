import AppComposition
import Foundation

#if canImport(AppIntents) && os(iOS)
    import AppIntents

    /// "Photograph a plant", from outside the application.
    ///
    /// This is the shortest path in the product and the reason the intent
    /// exists at all: from a locked phone to a live viewfinder in one press of
    /// the Action button, with no tab, no menu and no sheet in between.
    /// Shortcuts and Siri reach the same intent.
    ///
    /// It opens the application rather than running headlessly. A photograph
    /// needs a viewfinder — somebody has to see what they are pointing at — so
    /// there is nothing here that could honestly be done in the background, and
    /// an intent that pretended otherwise would return success for a picture
    /// nobody took.
    ///
    /// The request is recorded on the composition root and the shell acts on
    /// it, because opening the camera may first require signing in or choosing
    /// a garden. Dropping the request in that case would make the button work
    /// only when it was least needed.
    struct CapturePlantIntent: AppIntent {
        static let title: LocalizedStringResource = "Photograph a plant"
        static let description = IntentDescription(
            "Opens Verdery's camera so you can photograph a plant. The photograph is saved on this phone immediately, whether or not there is a signal."
        )

        /// The whole point: the viewfinder, not a result card.
        static let openAppWhenRun = true

        @MainActor
        func perform() async throws -> some IntentResult {
            AppIntentBridge.requestCapture()
            return .result()
        }
    }

    /// Offered to Siri and the Shortcuts gallery without anybody assembling a
    /// shortcut first. A capability nobody can find is a capability nobody has.
    struct VerderyShortcuts: AppShortcutsProvider {
        static var appShortcuts: [AppShortcut] {
            AppShortcut(
                intent: CapturePlantIntent(),
                phrases: [
                    "Photograph a plant with \(.applicationName)",
                    "Add a plant to \(.applicationName)",
                ],
                shortTitle: "Photograph a plant",
                systemImageName: "camera.fill"
            )
        }
    }
#endif

/// The one piece of global state an `AppIntent` can reach.
///
/// An intent is constructed by the system, not by this application, so it
/// cannot be handed the composition root the way every screen is. This is the
/// narrowest possible seam: one setter, written once at launch, holding one
/// weak reference — and never a way to reach anything else.
@MainActor
public enum AppIntentBridge {
    private static weak var composition: AppCompositionRoot?

    public static func register(_ composition: AppCompositionRoot) {
        Self.composition = composition
    }

    /// A no-op before launch finishes, which is correct rather than merely
    /// safe: with no application there is no viewfinder to open, and the system
    /// is about to launch one that will read this again.
    static func requestCapture() {
        composition?.requestCapture()
    }
}
