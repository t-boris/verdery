import Foundation

/// The wire shape of a garden outbox operation's stored payload
/// (`OutboxOperation.payload`).
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s
/// `SyncGardenOperationPayload` / `SyncGardenCommand` exactly — `recordType`,
/// `gardenId`, and every `commandType` string are the contract's own
/// discriminator values, copied verbatim, not re-derived at push time — so a
/// later stage's real push call (`POST /v1/sync/push`,
/// `SyncOperation.payload`) can decode `OutboxOperation.payload` and
/// serialize it for the wire without another local migration.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Canonical payload"); packages/api-contracts/openapi.yaml,
/// `SyncGardenOperationPayload`, `SyncGardenCommand` and its four branches.
struct GardenSyncOperationPayload: Encodable {
    let gardenId: String
    let command: GardenSyncCommand

    private enum CodingKeys: String, CodingKey {
        case recordType, gardenId, command
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // The contract's `SyncGardenOperationPayload.recordType` discriminator
        // — always the literal `"garden"` for this payload family.
        try container.encode("garden", forKey: .recordType)
        try container.encode(gardenId, forKey: .gardenId)
        try container.encode(command, forKey: .command)
    }
}

/// One `SyncGardenCommand` branch. `commandType` values match the contract's
/// discriminator mapping exactly — `gardens.create`, `gardens.rename`,
/// `gardens.archive`, `gardens.delete_request` (not `gardens.requestDeletion`;
/// see `packages/api-contracts/openapi.yaml`,
/// `SyncRequestGardenDeletionCommand.commandType.enum`).
enum GardenSyncCommand: Encodable {
    case create(name: String)
    case rename(name: String, expectedRevision: Int)
    case archive(expectedRevision: Int)
    case requestDeletion(expectedRevision: Int)

    private enum CodingKeys: String, CodingKey {
        case commandType, expectedRevision, request
    }

    /// `SyncCreateGardenCommand.request` / `SyncRenameGardenCommand.request`
    /// both resolve to `CreateGardenRequest` / `RenameGardenRequest`, which
    /// are identical shapes (`{ "name": string }`).
    private struct NameRequest: Encodable {
        let name: String
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .create(let name):
            try container.encode("gardens.create", forKey: .commandType)
            try container.encode(NameRequest(name: name), forKey: .request)

        case .rename(let name, let expectedRevision):
            try container.encode("gardens.rename", forKey: .commandType)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(NameRequest(name: name), forKey: .request)

        case .archive(let expectedRevision):
            try container.encode("gardens.archive", forKey: .commandType)
            try container.encode(expectedRevision, forKey: .expectedRevision)

        case .requestDeletion(let expectedRevision):
            try container.encode("gardens.delete_request", forKey: .commandType)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        }
    }
}

enum GardenSyncCommandPayload {
    /// The command-payload version every garden outbox operation is
    /// currently authored under (`OutboxOperation.commandVersion`;
    /// `packages/api-contracts/openapi.yaml`, `SyncOperation.commandVersion`
    /// — "Defaults to the batch's `operationPayloadVersion` when omitted").
    /// Declared explicitly here rather than relying on that default, so a
    /// future payload-shape change has an obvious place to bump it.
    static let version = 1

    /// Encodes a `GardenSyncOperationPayload` to the UTF-8 JSON text stored
    /// in `OutboxOperation.payload`.
    static func encode(gardenId: String, command: GardenSyncCommand) throws -> String {
        let payload = GardenSyncOperationPayload(gardenId: gardenId, command: command)
        let data = try JSONEncoder().encode(payload)

        guard let text = String(data: data, encoding: .utf8) else {
            throw GardenCommandError.payloadEncodingFailed
        }

        return text
    }
}
