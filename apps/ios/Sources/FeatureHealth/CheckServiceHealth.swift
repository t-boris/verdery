import CoreDomain
import CoreNetworking

/// Application use case behind the service status screen.
///
/// It is a thin pass-through today. It exists anyway because it is the seam
/// where bounded retry, cached last-known status, and telemetry attach, and
/// introducing that seam later would mean editing the view model instead of a
/// use case.
///
/// Source: architecture/ios-application-design.md, section "5.2 Application".
public struct CheckServiceHealth: Sendable {
    private let gateway: any HealthGateway

    public init(gateway: any HealthGateway) {
        self.gateway = gateway
    }

    public func callAsFunction() async throws -> ServiceHealth {
        try await gateway.readiness()
    }
}
