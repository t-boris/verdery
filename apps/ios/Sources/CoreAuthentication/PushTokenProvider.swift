import Foundation

#if canImport(FirebaseMessaging)
    import FirebaseMessaging
#endif

/// This installation's current FCM registration token.
///
/// A protocol, so nothing above `CoreAuthentication` imports a Firebase SDK —
/// the same shape `AuthTokenProvider` and `AppCheckTokenProvider` already take,
/// and the reason `PushRegistrationController` can be built and reasoned about
/// on the headless macOS target this package also compiles for.
///
/// The token is a secret: it is fetched, handed to one registration request,
/// and never logged, echoed, or stored anywhere on this device but Firebase's
/// own keychain entry.
public protocol PushTokenProvider: Sendable {
    /// `nil` when there is no token yet — APNs has not answered, the user has
    /// not granted permission, or this build has no push entitlement. Never an
    /// error: absence of a token is an ordinary state, and push is an
    /// accelerator rather than a requirement.
    func currentPushToken() async -> String?
}

/// The real provider, backed by Firebase Cloud Messaging.
public struct FirebasePushTokenProvider: PushTokenProvider {
    public init() {}

    public func currentPushToken() async -> String? {
        #if canImport(FirebaseMessaging)
            // A throwing call that is deliberately not propagated: every
            // failure here means "no token right now", which the caller
            // already handles, and turning it into an error would surface a
            // push problem on a screen somebody opened for something else.
            try? await Messaging.messaging().token()
        #else
            nil
        #endif
    }
}

/// Used by the headless macOS build and by tests, where no APNs exists.
public struct NoPushTokenProvider: PushTokenProvider {
    public init() {}
    public func currentPushToken() async -> String? { nil }
}

/// Handing the APNs device token to Firebase Cloud Messaging.
///
/// Explicit rather than relying on the SDK's method swizzling. Swizzling works
/// until something else in the process swizzles the same selector, and a push
/// channel that silently stops registering is close to undiagnosable from the
/// outside — the token simply never appears and every send is a no-op.
public enum PushTransportBridge {
    public static func setAPNsToken(_ deviceToken: Data) {
        #if canImport(FirebaseMessaging)
            Messaging.messaging().apnsToken = deviceToken
        #endif
    }
}
