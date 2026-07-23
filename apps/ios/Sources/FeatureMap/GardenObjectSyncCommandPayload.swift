import CoreDomain
import CoreNetworking
import Foundation

/// The wire shape of a map-object outbox operation's stored payload
/// (`OutboxOperation.payload`).
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s
/// `SyncGardenObjectOperationPayload` exactly — `recordType`, `gardenId`, and
/// `command` are the contract's own field names, and `recordType`'s value is
/// the contract's own discriminator string, copied verbatim, not guessed:
/// `"gardenObject"`, not the more obvious-looking `"mapObject"` — see that
/// schema's own `enum: [gardenObject]` in the YAML. Precisely the kind of
/// mismatch `FeatureGardens.GardenSyncOperationPayload`'s own doc comment
/// warns about (`gardens.delete_request`, not the guessable
/// `gardens.requestDeletion`).
///
/// `command` encodes through `CoreNetworking.MapCommandWireCoding`, not
/// `CoreDomain.MapCommandPayload`'s own `Codable` conformance
/// (`MapCommandCoding.swift`): the contract reuses `MapCommandPayload`
/// wholesale for this field (`SyncGardenObjectOperationPayload.command`'s own
/// description in the YAML), meaning the wire shape here must be the exact
/// same flat `categoryDetails` encoding `SubmitMapCommand`'s live request
/// already uses, not the nested domain-shaped one — see
/// `MapCommandWireCoding`'s doc comment for the full reasoning and why this
/// type reuses it rather than duplicating it.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Canonical payload"); packages/api-contracts/openapi.yaml,
/// `SyncGardenObjectOperationPayload`.
struct GardenObjectSyncOperationPayload: Encodable {
    let gardenId: String
    let command: MapCommandPayload

    private enum CodingKeys: String, CodingKey {
        case recordType, gardenId, command
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("gardenObject", forKey: .recordType)
        try container.encode(gardenId, forKey: .gardenId)
        try MapCommandWireCoding.encode(command, to: container.superEncoder(forKey: .command))
    }
}

enum GardenObjectSyncCommandPayload {
    /// The command-payload version every map-object outbox operation is
    /// currently authored under — see
    /// `FeatureGardens.GardenSyncCommandPayload.version`'s identical
    /// reasoning.
    static let version = 1

    /// Encodes a `GardenObjectSyncOperationPayload` to the UTF-8 JSON text
    /// stored in `OutboxOperation.payload`.
    static func encode(gardenId: String, command: MapCommandPayload) throws -> String {
        let payload = GardenObjectSyncOperationPayload(gardenId: gardenId, command: command)
        let data = try JSONEncoder().encode(payload)

        guard let text = String(data: data, encoding: .utf8) else {
            throw MapCommandError.payloadEncodingFailed
        }

        return text
    }
}
