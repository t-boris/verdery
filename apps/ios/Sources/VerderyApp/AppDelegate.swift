import AppComposition
import Foundation

#if os(iOS)
import UIKit

/// The one `UIApplicationDelegate` responsibility this app needs that
/// SwiftUI's `App` protocol has no hook for: receiving
/// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`,
/// which the OS calls — potentially relaunching this app from fully
/// terminated — once a background upload session
/// (`AppCompositionRoot.mediaBackgroundSessionIdentifier`,
/// `CoreMediaTransfer.URLSessionBackgroundUploadTransport`) has queued
/// events ready to deliver.
///
/// `composition` is set by `VerderyApp.init`, as early in the launch
/// sequence as `@UIApplicationDelegateAdaptor` allows — see that type's own
/// doc comment. `nil` only in the narrow window before that assignment runs
/// (this delegate object itself is constructed before `VerderyApp.init`'s
/// body executes), in which case the OS's completion handler is still
/// called immediately rather than dropped, so the system does not treat
/// this process as unresponsive.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; implementation-plan.md work package P6-IOS-01.
final class AppDelegate: NSObject, UIApplicationDelegate {
    var composition: AppCompositionRoot?

    /// `completionHandler` is declared `@Sendable` here even though
    /// `UIApplicationDelegate` does not require it: the handler is ultimately
    /// handed to an `actor`
    /// (`CoreMediaTransfer.URLSessionBackgroundUploadTransport`) by
    /// `AppCompositionRoot.handleBackgroundURLSessionEvents`, so it genuinely
    /// crosses an isolation boundary and Swift 6 will not let a non-`Sendable`
    /// closure make that trip. Narrowing a witness's parameter this way is
    /// sound — every caller is UIKit itself, which invokes this on the main
    /// actor with a closure it makes no other use of.
    func application(
        _: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping @Sendable () -> Void
    ) {
        guard let composition else {
            completionHandler()
            return
        }

        // `UIApplicationDelegate` is `@MainActor`-isolated, so this already
        // runs on the main actor — no `Task` hop is needed, and adding one
        // would only delay a handoff the OS expects promptly.
        composition.handleBackgroundURLSessionEvents(
            identifier: identifier, completionHandler: completionHandler)
    }

    /// The only hook iOS offers for a per-screen orientation answer; SwiftUI
    /// has no equivalent. The application is portrait apart from the map
    /// editor — see `AppComposition.OrientationPolicy`, which owns the
    /// decision and asks UIKit to re-read it whenever it changes.
    ///
    /// Portrait when the composition root does not exist yet: that window is
    /// before the first screen appears, and portrait is what every screen but
    /// one wants anyway.
    func application(
        _: UIApplication,
        supportedInterfaceOrientationsFor _: UIWindow?
    ) -> UIInterfaceOrientationMask {
        composition?.orientationPolicy.supportedOrientations ?? .portrait
    }
}
#endif
