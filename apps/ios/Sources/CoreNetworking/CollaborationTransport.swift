import CoreDomain
import Foundation

/// Wire shapes of the collaboration operations (P9A-API-01, P9A-OWNER-01).
///
/// These types stay internal: the architecture requires generated or
/// transport models to remain behind the application gateway.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules"; packages/api-contracts/openapi.yaml, tag `Collaboration`.
struct GardenMemberTransport: Codable {
    let id: String
    let gardenId: String
    let profileId: String
    let role: String
    let state: String
    let createdAt: Date
    let updatedAt: Date

    var domainValue: GardenMember? {
        guard
            let role = GardenRole(rawValue: role),
            let state = GardenMemberState(rawValue: state)
        else {
            return nil
        }

        return GardenMember(
            id: id, gardenId: gardenId, profileId: profileId, role: role, state: state,
            createdAt: createdAt, updatedAt: updatedAt
        )
    }
}

struct GardenMemberListResultTransport: Decodable {
    let items: [GardenMemberTransport]
}

struct ChangeGardenMemberRoleRequestTransport: Encodable {
    let role: String
}

/// Shared shape for `Invitation` and `CreateInvitationResult` (the latter is
/// the former plus `token` in the wire's own `allOf` composition, which JSON
/// flattens into one object) — one struct decodes both, with `token` simply
/// absent whenever the response is a plain `Invitation`.
struct InvitationTransport: Codable {
    let id: String
    let gardenId: String
    let inviterProfileId: String
    let intendedRole: String
    let intendedEmail: String?
    let state: String
    let createdAt: Date
    let expiresAt: Date
    let acceptedAt: Date?
    let revokedAt: Date?
    let resultingMembershipId: String?
    let token: String?

    var domainValue: GardenInvitation? {
        guard
            let intendedRole = CollaboratorRole(rawValue: intendedRole),
            let state = GardenInvitationState(rawValue: state)
        else {
            return nil
        }

        return GardenInvitation(
            id: id, gardenId: gardenId, inviterProfileId: inviterProfileId,
            intendedRole: intendedRole, intendedEmail: intendedEmail, state: state,
            createdAt: createdAt, expiresAt: expiresAt, acceptedAt: acceptedAt,
            revokedAt: revokedAt, resultingMembershipId: resultingMembershipId
        )
    }

    /// Only meaningful on a `createInvitation` response, where the contract
    /// guarantees `token` is present.
    var createdDomainValue: CreatedGardenInvitation? {
        guard let invitation = domainValue, let token else { return nil }
        return CreatedGardenInvitation(invitation: invitation, token: token)
    }
}

struct InvitationListResultTransport: Decodable {
    let items: [InvitationTransport]
}

struct CreateInvitationRequestTransport: Encodable {
    let intendedRole: String
    let intendedEmail: String?
}

struct AcceptInvitationRequestTransport: Encodable {
    let token: String
}

struct TransferOwnershipRequestTransport: Encodable {
    let toProfileId: String
    let resultingRole: String
}

/// Decodes both `OwnershipTransfer` and `listIncomingOwnershipTransfers`'s
/// own `IncomingOwnershipTransfer` item shape (P9A-OWNER-02) — the latter is
/// the former plus `gardenName` in the wire's own `allOf` composition, which
/// JSON flattens into one object, the same "one struct decodes both" shape
/// `InvitationTransport`'s own `token` field already uses for
/// `CreateInvitationResult`. `authenticatedAt` (the recent-authentication
/// instant) is contract-required on the wire but not modeled here — nothing
/// in this app's UI reads it, and `JSONDecoder` tolerates an unmodeled key on
/// a `Decodable` struct exactly as it already does across every other
/// gateway in this module.
struct OwnershipTransferTransport: Codable {
    let id: String
    let gardenId: String
    let fromProfileId: String
    let toProfileId: String
    let fromResultingRole: String
    let state: String
    let requestedAt: Date
    let completedAt: Date?
    let cancelledAt: Date?
    let cancellationReason: String?
    /// Present only on a `listIncomingOwnershipTransfers` item.
    let gardenName: String?

    var domainValue: GardenOwnershipTransfer? {
        guard
            let fromResultingRole = CollaboratorRole(rawValue: fromResultingRole),
            let state = GardenOwnershipTransferState(rawValue: state)
        else {
            return nil
        }

        return GardenOwnershipTransfer(
            id: id, gardenId: gardenId, fromProfileId: fromProfileId, toProfileId: toProfileId,
            fromResultingRole: fromResultingRole, state: state, requestedAt: requestedAt,
            completedAt: completedAt, cancelledAt: cancelledAt, cancellationReason: cancellationReason
        )
    }

    /// Only meaningful on a `listIncomingOwnershipTransfers` item, where the
    /// contract guarantees `gardenName` is present.
    var incomingDomainValue: IncomingGardenOwnershipTransfer? {
        guard let transfer = domainValue, let gardenName else { return nil }
        return IncomingGardenOwnershipTransfer(transfer: transfer, gardenName: gardenName)
    }
}

struct IncomingOwnershipTransferListResultTransport: Decodable {
    let items: [OwnershipTransferTransport]
}
