import CoreDomain
import Foundation

/// Encodes a `MapCommandPayload` for the real wire request, where
/// `categoryDetails` (on `createObject`/`changeProperties`) is flat —
/// `{"category": ..., "structureKind": ..., ...}`, matching
/// `packages/api-contracts/openapi.yaml` — not the nested shape
/// `MapCommandPayload`'s own `Codable` conformance
/// (`CoreDomain/MapCommandCoding.swift`) produces, which stays domain-shaped
/// because `Tests/CoreDomainTests/InverseCommandTests.swift` decodes the
/// shared `command-inverse.json` fixture through that same conformance and
/// that fixture (like `deriveInverseCommand` itself, which it exercises) is
/// domain-shaped by design, not wire-shaped.
///
/// Encode-only: this client only ever constructs and sends a command, never
/// receives one back — the server's responses are `GardenObject`/
/// `GardenMapDocument` (see `GardenObjectDetailsWireCoding`, used by
/// `GardenObjectTransport` for that direction), never a `MapCommandPayload`.
/// A decode side would have no caller.
///
/// Mirrors `MapCommandCoding.swift`'s `encode(to:)` switch field-for-field;
/// the only difference is `categoryDetails`'s two cases. Confirmed against
/// the real server during this work package — see
/// `GardenObjectDetailsWireCoding`'s doc comment for the full story.
///
/// `public` since P5-IOS-02 (Stage 4b): `FeatureMap.GardenObjectSyncCommandPayload`
/// reuses this exact wire coding for an offline command's outbox payload —
/// `packages/api-contracts/openapi.yaml`'s `SyncGardenObjectOperationPayload`
/// reuses `MapCommandPayload` verbatim for the *push* wire shape too, so the
/// outbox's stored payload must be this same flat encoding, not
/// `MapCommandCoding.swift`'s domain-shaped one, for a later stage's real
/// push call to decode and forward without another local migration —
/// matching `FeatureGardens.GardenSyncCommandPayload`'s identical reasoning.
/// Duplicating this ~150-line switch a second time in `FeatureMap` instead of
/// widening this one type's visibility was judged the worse option.
public enum MapCommandWireCoding {
    private enum CodingKeys: String, CodingKey {
        case type
        case objectId
        case category
        case geometry
        case label
        case categoryDetails
        case expectedRevision
        case translationMetres
        case operation
        case ringIndex
        case vertexIndex
        case position
        case resultObjectIds
        case atVertexIndex
        case firstObjectId
        case firstExpectedRevision
        case secondObjectId
        case secondExpectedRevision
        case resultObjectId
        case plantObjectId
        case targetObjectId
        case backgroundObjectId
        case referencePoints
        case proposalId
        case decision
        case editedGeometry
        case sourceObjectId
        case newObjectId
        case offsetMetres
    }

    public static func encode(_ payload: MapCommandPayload, to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(payload.type, forKey: .type)

        switch payload {
        case let .createObject(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.category, forKey: .category)
            try container.encode(command.geometry, forKey: .geometry)
            try container.encodeIfPresent(command.label, forKey: .label)
            if let categoryDetails = command.categoryDetails {
                try GardenObjectDetailsWireCoding.encode(
                    categoryDetails, to: container.superEncoder(forKey: .categoryDetails)
                )
            }

        case let .moveObject(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            try container.encode(command.translationMetres, forKey: .translationMetres)

        case let .replaceGeometry(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            try container.encode(command.geometry, forKey: .geometry)

        case let .editVertex(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            try container.encode(command.operation, forKey: .operation)
            try container.encode(command.ringIndex, forKey: .ringIndex)
            try container.encode(command.vertexIndex, forKey: .vertexIndex)
            try container.encodeIfPresent(command.position, forKey: .position)

        case let .splitLinework(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            try container.encode(command.resultObjectIds, forKey: .resultObjectIds)
            try container.encode(command.atVertexIndex, forKey: .atVertexIndex)

        case let .joinLinework(command):
            try container.encode(command.firstObjectId, forKey: .firstObjectId)
            try container.encode(command.firstExpectedRevision, forKey: .firstExpectedRevision)
            try container.encode(command.secondObjectId, forKey: .secondObjectId)
            try container.encode(command.secondExpectedRevision, forKey: .secondExpectedRevision)
            try container.encode(command.resultObjectId, forKey: .resultObjectId)

        case let .changeProperties(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            try container.encodeIfPresent(command.label, forKey: .label)
            if let categoryDetails = command.categoryDetails {
                try GardenObjectDetailsWireCoding.encode(
                    categoryDetails, to: container.superEncoder(forKey: .categoryDetails)
                )
            }

        case let .assignPlant(command):
            try container.encode(command.plantObjectId, forKey: .plantObjectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)
            // `targetObjectId` is `string | null` in TypeScript — always
            // present, never omitted — matching MapCommandCoding.swift's own
            // identical reasoning for this field.
            try container.encode(command.targetObjectId, forKey: .targetObjectId)

        case let .upsertCalibration(command):
            try container.encode(command.backgroundObjectId, forKey: .backgroundObjectId)
            try container.encode(command.referencePoints, forKey: .referencePoints)

        case let .decideProposal(command):
            try container.encode(command.proposalId, forKey: .proposalId)
            try container.encode(command.decision, forKey: .decision)
            try container.encodeIfPresent(command.editedGeometry, forKey: .editedGeometry)

        case let .deleteObject(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)

        case let .restoreObject(command):
            try container.encode(command.objectId, forKey: .objectId)
            try container.encode(command.expectedRevision, forKey: .expectedRevision)

        case let .duplicateObject(command):
            try container.encode(command.sourceObjectId, forKey: .sourceObjectId)
            try container.encode(command.newObjectId, forKey: .newObjectId)
            try container.encode(command.offsetMetres, forKey: .offsetMetres)
        }
    }
}
