import CoreDomain
import Foundation

/// Wire shapes of the health operations.
///
/// These types stay internal: the architecture requires generated or transport
/// models to remain behind the application gateway, so nothing outside this
/// module can accidentally depend on the contract's field names.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency Rules".
struct LivenessResultTransport: Decodable {
    enum Status: String, Decodable {
        case alive
    }

    let status: Status
    let version: String
}

struct DependencyStatusTransport: Decodable {
    enum Status: String, Decodable {
        case available
        case unavailable
    }

    let name: String
    let status: Status
    let detail: String?
}

struct ReadinessResultTransport: Decodable {
    enum Status: String, Decodable {
        case ready
        case notReady
    }

    let status: Status
    let version: String
    let dependencies: [DependencyStatusTransport]
}

extension LivenessResultTransport {
    var domainValue: ServiceLiveness {
        ServiceLiveness(version: version)
    }
}

extension DependencyStatusTransport {
    var domainValue: ServiceHealth.Dependency {
        ServiceHealth.Dependency(
            name: name,
            availability: status == .available ? .available : .unavailable,
            detail: detail
        )
    }
}

extension ReadinessResultTransport {
    var domainValue: ServiceHealth {
        ServiceHealth(
            readiness: status == .ready ? .ready : .notReady,
            version: version,
            dependencies: dependencies.map(\.domainValue)
        )
    }
}
