import CoreDomain
import Foundation

/// Wire shapes of the garden operations.
///
/// These types stay internal: the architecture requires generated or
/// transport models to remain behind the application gateway.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules"; packages/api-contracts/openapi.yaml, `Garden`.
struct GardenTransport: Codable {
    let id: String
    let name: String
    let lifecycleState: String
    let callerRole: String
    let revision: Int
    let createdAt: Date
    let updatedAt: Date
}

struct GardenListResultTransport: Decodable {
    let items: [GardenTransport]
    let nextCursor: String?
}

struct CreateGardenRequestTransport: Encodable {
    let name: String
}

struct RenameGardenRequestTransport: Encodable {
    let name: String
}

extension GardenTransport {
    var domainValue: Garden? {
        guard
            let lifecycleState = GardenLifecycleState(rawValue: lifecycleState),
            let callerRole = GardenRole(rawValue: callerRole)
        else {
            return nil
        }

        return Garden(
            id: id,
            name: name,
            lifecycleState: lifecycleState,
            callerRole: callerRole,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
