import CoreAuthentication
import CoreNetworking
import FeatureAuthentication
import FeatureRecommendations
import Foundation

/// The notification surfaces' factories, and the one long-lived push
/// controller — split from `AppCompositionRoot.swift` the same way every other
/// `AppCompositionRoot+*.swift` is, to keep that file under the 600-line rule.
extension AppCompositionRoot {
    /// The durable inbox. Reachable without any push permission, because the
    /// inbox is the record and push is only an accelerator.
    public func makeNotificationInboxViewModel() -> NotificationInboxViewModel {
        NotificationInboxViewModel(gateway: notificationGateway, strings: localizedStrings)
    }

    /// Which notifications reach you, and when they may not. Account-scoped,
    /// so it is reachable from the gardens list where no garden is chosen.
    public func makeNotificationPreferencesViewModel() -> NotificationPreferencesViewModel {
        NotificationPreferencesViewModel(gateway: notificationGateway, strings: localizedStrings)
    }

    /// Rendering an arriving silent push in the reader's own language.
    public func makePushRelay() -> PushRelay {
        PushRelay(gateway: notificationGateway, strings: localizedStrings)
    }

}
