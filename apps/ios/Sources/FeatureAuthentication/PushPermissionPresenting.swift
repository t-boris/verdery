import Foundation

/// What the account screen needs from this device's push channel.
///
/// A protocol rather than the controller itself, because the controller lives
/// in `AppComposition` — the aggregator — and a feature may not import it. The
/// account screen needs three sentences and one verb; this is exactly those.
@MainActor
public protocol PushPermissionPresenting: AnyObject {
    var permissionTitle: String { get }
    var permissionExplanation: String { get }
    var askTitle: String { get }
    var deniedText: String { get }
    var grantedText: String { get }
    var openSettingsTitle: String { get }

    /// Reads the current setting without asking for anything. The answer
    /// changes outside this application, so a cached one would be a lie.
    func refreshAuthorization() async
    /// Asks, once, and only from a button that says so.
    func requestAuthorization() async

    var isGranted: Bool { get }
    var isDenied: Bool { get }
}
