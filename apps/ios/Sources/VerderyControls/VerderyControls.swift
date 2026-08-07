import SwiftUI
import WidgetKit

#if canImport(AppIntents) && os(iOS)
    import AppIntents

    /// "Photograph a plant", from Control Center or the Lock Screen.
    ///
    /// The last door in the capture loop, and the shortest: a control on the
    /// Lock Screen reaches the viewfinder without unlocking into the
    /// application first. Together with the Action button, Shortcuts and Siri
    /// it means nobody standing in front of a plant has to go and find this
    /// application before photographing it.
    ///
    /// It opens a **URL** rather than reaching into the application, because it
    /// genuinely cannot reach in: a control runs in its own process, with its
    /// own memory, and has no access to the app's composition root. A URL is
    /// the one channel that already crosses that boundary — the same
    /// `verdery://` scheme a staked QR label uses — and it needs no App Group,
    /// no shared container and no second copy of any state to do it.
    ///
    /// `verdery://capture` is handled by `AppCompositionRoot.handleIncomingURL`,
    /// which records the request rather than acting on it, because opening the
    /// camera may first require a sign-in or a chosen garden.
    /// `@main` on the control itself. A `WidgetBundle` cannot hold one — a
    /// `ControlWidget` is not a `Widget` — and this extension ships exactly one
    /// control, so a bundle would be a container with a single occupant.
    @available(iOS 18.0, *)
    @main
    struct CapturePlantControl: ControlWidget {
        static let kind = "com.verdery.app.capture"

        var body: some ControlWidgetConfiguration {
            StaticControlConfiguration(kind: Self.kind) {
                ControlWidgetButton(action: OpenCaptureIntent()) {
                    Label("Photograph a plant", systemImage: "camera.fill")
                }
            }
            .displayName("Photograph a plant")
            .description("Opens Verdery's camera. The photograph is saved on this phone immediately, whether or not there is a signal.")
        }
    }

    /// Opening the application at its capture surface.
    ///
    /// A plain `AppIntent` with `openAppWhenRun` rather than an `OpenURLIntent`
    /// wrapper, so the URL it opens is stated once, here, next to the reason.
    @available(iOS 18.0, *)
    struct OpenCaptureIntent: AppIntent {
        static let title: LocalizedStringResource = "Photograph a plant"
        static let openAppWhenRun = true

        @MainActor
        func perform() async throws -> some IntentResult & OpensIntent {
            .result(
                opensIntent: OpenURLIntent(URL(string: "verdery://capture")!)
            )
        }
    }
#endif
