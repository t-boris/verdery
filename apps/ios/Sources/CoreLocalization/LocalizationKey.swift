/// Keys the application resolves against the localization catalogue.
///
/// Feature code refers to these constants instead of typing a literal, so a key
/// that is removed from the catalogue fails to compile rather than rendering as
/// its own name at runtime.
///
/// Geometry validation keys are not listed here: their keys are the stable issue
/// codes emitted by CoreDomain, and duplicating them would create a second
/// source of truth.
public enum LocalizationKey: String, Sendable, CaseIterable {
    case networkUnreachable = "error.network.unreachable"
    case serverUnexpected = "error.server.unexpected"

    case healthTitle = "health.title"
    case healthStatusChecking = "health.status.checking"
    case healthStatusReady = "health.status.ready"
    case healthStatusNotReady = "health.status.notReady"
    case healthStatusUnreachable = "health.status.unreachable"
    case healthVersion = "health.version"
    case healthDependencyUnavailable = "health.dependency.unavailable"
    case healthActionRefresh = "health.action.refresh"
}
