import Foundation

/// The authenticated caller's own role on a garden.
///
/// Informational for client UI only — the server re-evaluates authorization
/// on every request and never trusts a client-submitted role.
///
/// Source: architecture/identity-and-authorization.md, section "8. Garden Roles".
public enum GardenRole: String, Equatable, Sendable, CaseIterable {
    case owner
    case editor
    case viewer
}

/// `deletionRequested` starts the deletion workflow; it is not immediate
/// deletion. No `deleted` case exists yet: nothing can reach it before the
/// purge workflow that would produce it is built.
///
/// Source: architecture/data-and-geospatial-design.md, section "15. Deletion".
public enum GardenLifecycleState: String, Equatable, Sendable, CaseIterable {
    case active
    case archived
    case deletionRequested
}

/// A garden as the application understands it: identity and lifecycle
/// metadata only. No coordinate space, map objects, or geometry — those
/// arrive with P3-DATA-01.
///
/// Source: architecture/data-and-geospatial-design.md, section
/// "6. Garden Aggregate"; packages/api-contracts/openapi.yaml, `Garden`.
public struct Garden: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let lifecycleState: GardenLifecycleState
    public let callerRole: GardenRole
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        name: String,
        lifecycleState: GardenLifecycleState,
        callerRole: GardenRole,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.name = name
        self.lifecycleState = lifecycleState
        self.callerRole = callerRole
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
