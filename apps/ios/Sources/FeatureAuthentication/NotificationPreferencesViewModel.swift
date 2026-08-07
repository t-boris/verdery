import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Which notifications reach you, and when they may not.
///
/// It sits with the account rather than with the inbox because that is what it
/// is: an account-wide setting, reachable from every screen including the
/// gardens list where no garden is chosen. Only the caller's global rows are
/// edited here — a per-garden override is a garden-scoped decision and belongs
/// on a garden, not on a screen that may be opened with none selected.
@MainActor
@Observable
public final class NotificationPreferencesViewModel {
    public enum State: Equatable {
        case loading
        case loaded(NotificationPreferences)
        case unreachable
    }

    public private(set) var state: State = .loading
    public private(set) var isSaving = false
    public private(set) var statusMessage: String?
    public private(set) var failureMessage: String?

    /// The two types this server produces. Held as a list rather than derived
    /// from the loaded document, because "no entry" means enabled — a screen
    /// built only from returned rows would show nothing at all to somebody who
    /// has never changed a setting, which is everybody at first.
    public static let editableTypes = ["care_recommendation", "export_ready"]

    private let gateway: any NotificationGateway
    private let strings: LocalizedStrings
    private let presentation: NotificationPresentation

    public init(
        gateway: any NotificationGateway,
        strings: LocalizedStrings,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.gateway = gateway
        self.strings = strings
        self.presentation = NotificationPresentation(strings: strings, locale: locale)
    }

    // MARK: - Loading

    public func load() async {
        do {
            state = .loaded(try await gateway.getNotificationPreferences())
        } catch {
            state = .unreachable
        }
    }

    // MARK: - Editing
    //
    // Every edit writes immediately. The document is small, the write is a
    // whole replacement, and a deferred "Save" on a settings screen is the
    // form-shaped habit this redesign removed everywhere else.

    public func setInApp(_ enabled: Bool, for notificationType: String) async {
        guard case let .loaded(preferences) = state else { return }
        let current = preferences.setting(for: notificationType, gardenId: nil)
        await write(
            preferences.replacing(
                current.withChannels(inApp: enabled, push: current.pushEnabled)
            )
        )
    }

    public func setPush(_ enabled: Bool, for notificationType: String) async {
        guard case let .loaded(preferences) = state else { return }
        let current = preferences.setting(for: notificationType, gardenId: nil)
        await write(
            preferences.replacing(
                current.withChannels(inApp: current.inAppEnabled, push: enabled)
            )
        )
    }

    public func setQuietHours(_ quietHours: NotificationQuietHours?) async {
        guard case let .loaded(preferences) = state else { return }
        // A degenerate window is rejected by the server. Refusing it here
        // spends no request and says the same thing sooner.
        if let quietHours, quietHours.isDegenerate { return }
        await write(preferences.withQuietHours(quietHours))
    }

    private func write(_ preferences: NotificationPreferences) async {
        guard case let .loaded(current) = state else { return }
        isSaving = true
        failureMessage = nil
        statusMessage = nil
        defer { isSaving = false }

        do {
            state = .loaded(
                try await gateway.updateNotificationPreferences(
                    preferences,
                    expectedRevision: current.revision
                )
            )
            statusMessage = strings(.notificationPreferencesSaved)
        } catch let error as APIGatewayError {
            failureMessage = message(for: error)
            // The local edit is dropped rather than kept: after a rejected
            // write, what is on screen must be what the server holds.
            await load()
        } catch {
            failureMessage = strings(.notificationPreferencesFailed)
        }
    }

    /// A revision conflict has a real remedy and it is not "try again": these
    /// settings changed elsewhere, and re-sending would overwrite whatever that
    /// was.
    private func message(for error: APIGatewayError) -> String {
        if case let .service(envelope, status, _) = error, status == 409 || status == 412 {
            _ = envelope
            return strings(.notificationPreferencesConflict)
        }
        if case .transport = error { return strings(.networkUnreachable) }
        return strings(.notificationPreferencesFailed)
    }

    // MARK: - Reading

    public func inAppEnabled(_ notificationType: String) -> Bool {
        guard case let .loaded(preferences) = state else { return true }
        return preferences.setting(for: notificationType, gardenId: nil).inAppEnabled
    }

    public func pushEnabled(_ notificationType: String) -> Bool {
        guard case let .loaded(preferences) = state else { return true }
        return preferences.setting(for: notificationType, gardenId: nil).pushEnabled
    }

    public var quietHours: NotificationQuietHours? {
        guard case let .loaded(preferences) = state else { return nil }
        return preferences.quietHours
    }

    // MARK: - Text

    public var title: String { strings(.notificationPreferencesTitle) }
    public var explanation: String { strings(.notificationPreferencesExplanation) }
    public var inAppLabel: String { strings(.notificationPreferencesInApp) }
    public var inAppHint: String { strings(.notificationPreferencesInAppHint) }
    public var pushLabel: String { strings(.notificationPreferencesPush) }
    public var pushHint: String { strings(.notificationPreferencesPushHint) }
    public var quietHoursLabel: String { strings(.notificationPreferencesQuietHours) }
    public var quietHoursHint: String { strings(.notificationPreferencesQuietHoursHint) }
    public var closeTitle: String { strings(.plantsClose) }
    public var retryTitle: String { strings(.notificationsRetry) }
    public var offlineMessage: String { strings(.notificationsOffline) }

    public func typeName(_ notificationType: String) -> String {
        presentation.typeName(notificationType)
    }

    public func quietWindowText(_ quietHours: NotificationQuietHours) -> String {
        presentation.quietWindowText(quietHours)
    }

    public func clockText(_ minuteOfDay: Int) -> String {
        presentation.clockText(minuteOfDay)
    }
}
