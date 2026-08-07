import AppComposition
import CoreAuthentication
import Foundation

#if os(iOS)
import UIKit
import UserNotifications

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

    // MARK: - Push
    //
    // The server sends DATA-ONLY messages: `contentAvailable: true` carrying a
    // notification id, and deliberately no `notification` block. iOS therefore
    // shows nothing by itself, which is the point — the wording is chosen on
    // this device, in this reader's language, at the moment it is shown. See
    // `AppComposition.PushRelay`.
    //
    // Nothing here asks for permission. That prompt belongs to a button
    // somebody presses on the notification settings screen, because iOS grants
    // it exactly once and a prompt shown before its value is demonstrated is
    // the prompt people refuse.

    func application(
        _: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushTransportBridge.setAPNsToken(deviceToken)
        guard let composition else { return }
        Task { await composition.pushRegistration.registerCurrentToken() }
    }

    /// A device with no push is an ordinary device. The inbox is the record and
    /// carries on regardless, so this is deliberately not surfaced anywhere.
    func application(
        _: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError _: Error
    ) {}

    /// A silent push arrived, possibly with this application in the background.
    ///
    /// The completion handler's argument is the OS's own budget signal: report
    /// `.newData` only when a banner was actually posted, so background
    /// wake-ups this application does not use are wound down rather than
    /// wasted.
    func application(
        _: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping @Sendable (UIBackgroundFetchResult) -> Void
    ) {
        guard let composition else {
            completionHandler(.noData)
            return
        }
        let relay = composition.makePushRelay()
        Task { @MainActor in
            switch await relay.handle(userInfo: userInfo) {
            case .presented: completionHandler(.newData)
            case .nothingNew: completionHandler(.noData)
            case .failed: completionHandler(.failed)
            }
        }
    }
}

/// Presenting and following notifications.
///
/// Split from the delegate's own conformance list for readability only; it is
/// the same object, set as the notification centre's delegate in
/// `VerderyApp.init`.
extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Shown even while the application is open. The banner is the same record
    /// as the inbox row, and suppressing it in the foreground would mean a
    /// person looking at one garden never learns about another.
    ///
    /// The completion-handler form, not the `async` one, and `nonisolated`:
    /// `UNUserNotificationCenterDelegate`'s requirements are nonisolated and
    /// its parameters are not `Sendable`, so the `async` overload cannot be
    /// satisfied by a `@MainActor` type without sending a non-`Sendable` value
    /// across an isolation boundary. Only the iOS build catches this — the
    /// headless macOS build has no UserNotifications delegate to check.
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    /// Tapping a banner follows where it points. An unknown or unparsable link
    /// opens the ordinary starting screen rather than an error: deep links
    /// carry resource ids and never bearer access, so falling back reveals
    /// nothing, and the entry is still in the inbox.
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        // Only the decoded link crosses to the main actor — a value type, not
        // the response object, which is what makes the hop sound.
        let deepLink = (
            response.notification.request.content.userInfo[PushRelay.deepLinkKey] as? String
        ).flatMap(PushRelay.decode)

        Task { @MainActor in
            if let deepLink {
                composition?.openNotificationDeepLink(deepLink)
            }
            completionHandler()
        }
    }
}
#endif
