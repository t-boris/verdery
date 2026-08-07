import CoreDomain
import CoreLocalization
import FeatureAuthentication
import CoreNetworking
import CorePersistence
import Foundation
import Observation

#if canImport(UserNotifications)
    import UserNotifications
#endif

/// This device's push channel: permission, token, registration.
///
/// Three rules the screens depend on:
///
/// 1. **Permission is never a precondition.** The inbox is written when an
///    intent is created, before and independent of any delivery attempt, so
///    refusing push costs a person nothing but speed. Nothing in this
///    application blocks on it and nothing asks for it at launch.
/// 2. **The token is a secret.** It goes up in a registration body and is
///    never read back, never logged, and never stored anywhere on this device
///    but Firebase's own keychain entry.
/// 3. **Registration is keyed by the durable installation id**, the same one
///    synchronization already mints — one device, one identity. The channel's
///    lifecycle is separate from the sync installation's (signing out removes
///    the channel and leaves the installation), which is why registering and
///    removing are distinct calls rather than a side effect of either.
@MainActor
@Observable
public final class PushRegistrationController: PushPermissionPresenting {
    public enum Authorization: Equatable {
        case notDetermined
        case granted
        /// Switched off in iOS Settings. A real, displayable state: the screen
        /// says the inbox is unaffected rather than nagging.
        case denied
    }

    public private(set) var authorization: Authorization = .notDetermined
    public private(set) var isRegistered = false

    private let gateway: any NotificationGateway
    private let installationStore: any ClientInstallationIdentityStore
    private let strings: LocalizedStrings
    /// Injected rather than imported: `FirebaseMessaging` lives in the
    /// application target, and this type stays testable — and buildable on
    /// macOS, where `swift build` runs — by taking the token as a closure.
    private let currentPushToken: @Sendable () async -> String?

    public init(
        gateway: any NotificationGateway,
        installationStore: any ClientInstallationIdentityStore,
        strings: LocalizedStrings,
        currentPushToken: @escaping @Sendable () async -> String?
    ) {
        self.gateway = gateway
        self.installationStore = installationStore
        self.strings = strings
        self.currentPushToken = currentPushToken
    }

    // MARK: - Permission

    /// Reads the current setting without asking for anything.
    ///
    /// Called whenever the notification settings screen appears, because the
    /// answer changes outside this application: somebody can revoke push in
    /// iOS Settings and come back, and a cached "granted" would be a lie.
    public func refreshAuthorization() async {
        #if canImport(UserNotifications) && !targetEnvironment(macCatalyst)
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            authorization = switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: .granted
            case .denied: .denied
            default: .notDetermined
            }
        #endif
    }

    /// Asks, once, and only when somebody presses the button that says so.
    ///
    /// Never at launch. A permission prompt shown before its value is
    /// demonstrated is the prompt people refuse, and iOS gives an application
    /// exactly one chance to ask.
    public func requestAuthorization() async {
        #if canImport(UserNotifications) && !targetEnvironment(macCatalyst)
            let granted = (
                try? await UNUserNotificationCenter.current()
                    .requestAuthorization(options: [.alert, .sound, .badge])
            ) ?? false
            authorization = granted ? .granted : .denied
            guard granted else { return }
            await registerCurrentToken()
        #endif
    }

    // MARK: - Registration

    /// Registers this device's current token, if there is one.
    ///
    /// Safe to call repeatedly: the endpoint is a `PUT` keyed by installation
    /// id, and registering reactivates a channel a provider verdict disabled.
    /// A failure is swallowed on purpose — push is an accelerator, and a
    /// registration that did not land must not surface as an error on a screen
    /// the person opened to do something else.
    public func registerCurrentToken() async {
        guard let token = await currentPushToken() else { return }
        do {
            let installationId = try await installationStore.currentOrGenerated()
            let device = try await gateway.registerNotificationDevice(
                installationId: installationId,
                fcmToken: token
            )
            isRegistered = device.status == .active
        } catch {
            isRegistered = false
        }
    }

    /// Signing out. The channel goes; the installation identity stays, because
    /// the next person to sign in on this phone is still this phone.
    public func unregister() async {
        do {
            let installationId = try await installationStore.currentOrGenerated()
            try await gateway.removeNotificationDevice(installationId: installationId)
        } catch {
            // Idempotent by contract, and the account is being left anyway.
        }
        isRegistered = false
    }

    // MARK: - Text

    public var permissionTitle: String { strings(.pushPermissionTitle) }
    public var permissionExplanation: String { strings(.pushPermissionExplanation) }
    public var askTitle: String { strings(.pushPermissionAsk) }
    public var deniedText: String { strings(.pushPermissionDenied) }
    public var grantedText: String { strings(.pushPermissionGranted) }
    public var openSettingsTitle: String { strings(.pushOpenSettings) }

    public var isGranted: Bool { authorization == .granted }
    public var isDenied: Bool { authorization == .denied }
}
