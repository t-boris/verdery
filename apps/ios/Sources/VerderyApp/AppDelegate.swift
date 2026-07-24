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

    func application(
        _: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard let composition else {
            completionHandler()
            return
        }

        Task { @MainActor in
            composition.handleBackgroundURLSessionEvents(identifier: identifier, completionHandler: completionHandler)
        }
    }
}
#endif
