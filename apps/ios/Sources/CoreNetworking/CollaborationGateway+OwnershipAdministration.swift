import CoreDomain
import Foundation

/// Owner-set administration (P9A-OWNER-01): promote, demote, and the
/// request/cancel/accept/decline ownership-transfer flow.
///
/// Split from `CollaborationGateway.swift` to stay under this repository's
/// 600-line-per-file rule — see that file's own doc comment on
/// ``CollaborationGateway`` for why the protocol itself is not split: these
/// methods are already declared as requirements there, and Swift lets a
/// type's conformance be satisfied across more than one extension in the
/// same module, so `URLSessionCollaborationGateway: CollaborationGateway`'s
/// declaration in the other file is enough — this extension needs no
/// `: SomeProtocol` clause of its own.
extension URLSessionCollaborationGateway {
    public func promoteMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember {
        let result: GardenMemberTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/members/\(profileId)/promote",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainMember(result)
    }

    public func demoteOwner(
        gardenId: String,
        profileId: String,
        role: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenMember {
        let result: GardenMemberTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/members/\(profileId)/demote",
            body: ChangeGardenMemberRoleRequestTransport(role: role.rawValue),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainMember(result)
    }

    public func transferOwnership(
        gardenId: String,
        toProfileId: String,
        resultingRole: CollaboratorRole,
        idempotencyKey: String
    ) async throws -> GardenOwnershipTransfer {
        let result: OwnershipTransferTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/ownership-transfer",
            body: TransferOwnershipRequestTransport(toProfileId: toProfileId, resultingRole: resultingRole.rawValue),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainTransfer(result)
    }

    public func cancelOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        let result: OwnershipTransferTransport = try await transport.send(
            method: "DELETE",
            operationPath: "gardens/\(gardenId)/ownership-transfer",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainTransfer(result)
    }

    public func acceptOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        let result: OwnershipTransferTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/ownership-transfer/accept",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainTransfer(result)
    }

    public func declineOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer {
        let result: OwnershipTransferTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/ownership-transfer/decline",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )

        return try domainTransfer(result)
    }

    // MARK: Ownership-transfer reads (P9A-OWNER-02)

    public func fetchGardenOwnershipTransfer(gardenId: String) async throws -> GardenOwnershipTransfer {
        let result: OwnershipTransferTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/ownership-transfer",
            acceptedStatusCodes: [200]
        )

        return try domainTransfer(result)
    }

    public func fetchIncomingOwnershipTransfers() async throws -> [IncomingGardenOwnershipTransfer] {
        let result: IncomingOwnershipTransferListResultTransport = try await transport.get(
            operationPath: "ownership-transfers/incoming",
            acceptedStatusCodes: [200]
        )

        return try result.items.map(domainIncomingTransfer)
    }

    private func domainTransfer(_ transport: OwnershipTransferTransport) throws -> GardenOwnershipTransfer {
        guard let transfer = transport.domainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return transfer
    }

    private func domainIncomingTransfer(_ transport: OwnershipTransferTransport) throws -> IncomingGardenOwnershipTransfer {
        guard let incoming = transport.incomingDomainValue else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return incoming
    }
}
