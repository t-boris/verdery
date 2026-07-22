/// Immutable display state for the service status screen.
///
/// The view renders this and nothing else. Keeping it a value type with already
/// localized text means a view-model test asserts exactly what the user reads,
/// without rendering a view.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public enum ServiceHealthViewState: Equatable, Sendable {
    case idle
    case checking
    case loaded(ServiceHealthSummary)
    case failed(message: String)
}

/// What the screen shows once a status has been retrieved.
public struct ServiceHealthSummary: Equatable, Sendable {
    public let headline: String
    public let version: String
    /// One line per dependency the service reported as unavailable.
    public let unavailableDependencies: [String]

    public init(headline: String, version: String, unavailableDependencies: [String]) {
        self.headline = headline
        self.version = version
        self.unavailableDependencies = unavailableDependencies
    }
}
