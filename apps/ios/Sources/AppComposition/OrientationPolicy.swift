import Observation
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Which orientations the application will accept right now.
///
/// The application is portrait, with one exception: the map editor, where a
/// wide canvas is worth the whole screen and tracing a lot in landscape is
/// genuinely easier. An orientation absent from `project.yml`'s
/// `UISupportedInterfaceOrientations` can never be entered at all, so landscape
/// is declared there app-wide and refused here everywhere else.
///
/// Read by `AppDelegate.application(_:supportedInterfaceOrientationsFor:)`,
/// which is the only hook iOS offers for a per-screen answer — SwiftUI has no
/// equivalent.
@MainActor
@Observable
public final class OrientationPolicy {
    public enum Mode: Sendable, Equatable {
        case portraitOnly
        case allowLandscape
    }

    public private(set) var mode: Mode = .portraitOnly

    public init() {}

    /// Called by a screen that wants landscape while it is on screen.
    public func allowLandscape() {
        guard mode != .allowLandscape else { return }
        mode = .allowLandscape
        notifyUIKit()
    }

    /// Called on the way out. Also asks the window to come back to portrait:
    /// leaving the map sideways would otherwise strand the reader on a
    /// portrait-only screen rendered in landscape.
    public func restorePortrait() {
        guard mode != .portraitOnly else { return }
        mode = .portraitOnly
        notifyUIKit()
        requestPortrait()
    }

    #if canImport(UIKit)
    public var supportedOrientations: UIInterfaceOrientationMask {
        switch mode {
        case .portraitOnly: .portrait
        case .allowLandscape: [.portrait, .landscapeLeft, .landscapeRight]
        }
    }
    #endif

    /// UIKit caches the answer, so it has to be told the answer changed.
    private func notifyUIKit() {
        #if canImport(UIKit)
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for controller in windowScene.windows.compactMap(\.rootViewController) {
                controller.setNeedsUpdateOfSupportedInterfaceOrientations()
            }
        }
        #endif
    }

    private func requestPortrait() {
        #if canImport(UIKit)
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
        }
        #endif
    }
}

extension View {
    /// Marks a screen as one that may be rotated, for as long as it is shown.
    public func allowsLandscape(_ policy: OrientationPolicy) -> some View {
        onAppear { policy.allowLandscape() }
            .onDisappear { policy.restorePortrait() }
    }
}
