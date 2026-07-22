/// The backend process is running.
///
/// Liveness never reflects dependencies, so a degraded database must not make
/// this value change. Features that need dependency state ask for
/// ``ServiceHealth`` instead.
///
/// Source: packages/api-contracts/openapi.yaml, `LivenessResult`.
public struct ServiceLiveness: Equatable, Sendable {
    /// Build version of the running artifact, used when reporting a defect.
    public let version: String

    public init(version: String) {
        self.version = version
    }
}
