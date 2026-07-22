/// Backend availability as the application understands it.
///
/// The transport shape returned by `/v1/health/*` is not this type. Networking
/// maps the contract response onto these cases so that features never branch on
/// an HTTP status code or a wire enum.
///
/// Source: architecture/ios-application-design.md, section "5.3 Domain";
/// packages/api-contracts/openapi.yaml, `LivenessResult` and `ReadinessResult`.
public struct ServiceHealth: Equatable, Sendable {
    /// Whether the service can serve traffic, including its dependencies.
    public enum Readiness: String, Sendable, CaseIterable {
        case ready
        case notReady
    }

    /// A dependency the service declares, reported without any connection detail.
    public struct Dependency: Equatable, Sendable {
        public enum Availability: String, Sendable, CaseIterable {
            case available
            case unavailable
        }

        public let name: String
        public let availability: Availability
        /// Non-sensitive summary. Never contains connection strings or credentials.
        public let detail: String?

        public init(name: String, availability: Availability, detail: String? = nil) {
            self.name = name
            self.availability = availability
            self.detail = detail
        }
    }

    public let readiness: Readiness
    /// Build version of the running artifact, used when reporting a defect.
    public let version: String
    public let dependencies: [Dependency]

    public init(readiness: Readiness, version: String, dependencies: [Dependency]) {
        self.readiness = readiness
        self.version = version
        self.dependencies = dependencies
    }

    public var isReady: Bool { readiness == .ready }

    /// Dependencies that are currently unavailable, in the order the service reported them.
    public var unavailableDependencies: [Dependency] {
        dependencies.filter { $0.availability == .unavailable }
    }
}
