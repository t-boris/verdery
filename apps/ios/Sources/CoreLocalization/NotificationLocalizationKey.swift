/// The notification inbox and the preferences that govern it.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum NotificationLocalizationKey: String, Sendable, CaseIterable {
    case notificationsTitle = "notifications.title"
    case notificationsEmptyTitle = "notifications.emptyTitle"
    case notificationsEmptyMessage = "notifications.emptyMessage"
    case notificationsOffline = "notifications.offline"
    case notificationsRetry = "notifications.retry"
    case notificationsMarkRead = "notifications.markRead"
    case notificationsDismiss = "notifications.dismiss"
    case notificationsUnreadBadge = "notifications.unreadBadge"
    case notificationsLoadMore = "notifications.loadMore"
    case notificationsExpires = "notifications.expires"

    // MARK: - Templates
    //
    // A stable, versioned key per server template. An unknown key renders
    // through `notifications.genericTitle`/`genericBody` rather than showing a
    // raw key: the vocabulary is server-owned and open, and a client that
    // cannot name an entry can still show that one arrived.

    case templateCareRecommendationTitle = "notifications.template.careRecommendation.title"
    case templateCareRecommendationBody = "notifications.template.careRecommendation.body"
    case templateExportReadyTitle = "notifications.template.exportReady.title"
    case templateExportReadyBody = "notifications.template.exportReady.body"
    case templateGenericTitle = "notifications.template.generic.title"
    case templateGenericBody = "notifications.template.generic.body"

    // MARK: - Urgency, as a word rather than a colour alone

    case notificationsUrgencyLow = "notifications.urgency.low"
    case notificationsUrgencyNormal = "notifications.urgency.normal"
    case notificationsUrgencyHigh = "notifications.urgency.high"
    case notificationsUrgencyUrgent = "notifications.urgency.urgent"

    // MARK: - Preferences

    case notificationPreferencesTitle = "notificationPreferences.title"
    case notificationPreferencesOpen = "notificationPreferences.open"
    case notificationPreferencesExplanation = "notificationPreferences.explanation"
    case notificationPreferencesInApp = "notificationPreferences.inApp"
    case notificationPreferencesInAppHint = "notificationPreferences.inAppHint"
    case notificationPreferencesPush = "notificationPreferences.push"
    case notificationPreferencesPushHint = "notificationPreferences.pushHint"
    case notificationPreferencesQuietHours = "notificationPreferences.quietHours"
    case notificationPreferencesQuietHoursHint = "notificationPreferences.quietHoursHint"
    case notificationPreferencesQuietWindow = "notificationPreferences.quietWindow"
    case notificationPreferencesTypeCare = "notificationPreferences.type.careRecommendation"
    case notificationPreferencesTypeExport = "notificationPreferences.type.exportReady"
    case notificationPreferencesSave = "notificationPreferences.save"
    case notificationPreferencesSaved = "notificationPreferences.saved"
    case notificationPreferencesConflict = "notificationPreferences.conflict"
    case notificationPreferencesFailed = "notificationPreferences.failed"

    // MARK: - The system permission, described honestly

    case pushPermissionTitle = "push.permissionTitle"
    case pushPermissionExplanation = "push.permissionExplanation"
    case pushPermissionAsk = "push.permissionAsk"
    case pushPermissionDenied = "push.permissionDenied"
    case pushPermissionGranted = "push.permissionGranted"
    case pushOpenSettings = "push.openSettings"
}
