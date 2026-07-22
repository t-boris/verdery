import Foundation

/// Wire coding for ``MapCommandPayload`` and ``SplitResultObjectIds``.
///
/// Every command payload is a single flat JSON object carrying `type` plus
/// that case's own fields — never `{"type": ..., "payload": {...}}` — so this
/// cannot be synthesized. Centralizing it here, rather than making each of
/// the 13 payload structs independently `Codable`, keeps them free of
/// transport concerns, the same reason `GeometryCoding.swift` is kept
/// separate from `Geometry.swift`.
///
/// Source: packages/geometry-contracts/src/command.ts.
extension MapCommandPayload: Codable {
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

    /// Decodes and encodes `categoryDetails` through `GardenObjectDetails`'s
    /// own nested `Codable` (`{"category": ..., "details": {...}}`) — the
    /// domain shape, not the wire shape. This conformance is also what
    /// `Tests/CoreDomainTests/InverseCommandTests.swift` decodes the shared
    /// `command-inverse.json` fixture through, and that fixture (like
    /// `deriveInverseCommand` itself) is domain-shaped, agreeing with
    /// `packages/geometry-contracts`'s TypeScript consumer of the same file.
    /// The actual live wire request is flat — see
    /// `CoreNetworking/MapCommandWireCoding.swift`, which re-encodes a
    /// `MapCommandPayload` through `GardenObjectDetailsWireCoding` instead of
    /// this conformance, precisely because this one must stay domain-shaped.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        switch try container.decode(MapCommandType.self, forKey: .type) {
        case .createObject:
            self = .createObject(
                CreateObjectPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    category: try container.decode(GardenObjectCategory.self, forKey: .category),
                    geometry: try container.decode(Geometry.self, forKey: .geometry),
                    label: try container.decodeIfPresent(String.self, forKey: .label),
                    categoryDetails: try container.decodeIfPresent(
                        GardenObjectDetails.self, forKey: .categoryDetails
                    )
                )
            )

        case .moveObject:
            self = .moveObject(
                MoveObjectPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    translationMetres: try container.decode(
                        PlanarOffset.self, forKey: .translationMetres
                    )
                )
            )

        case .replaceGeometry:
            self = .replaceGeometry(
                ReplaceGeometryPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    geometry: try container.decode(Geometry.self, forKey: .geometry)
                )
            )

        case .editVertex:
            self = .editVertex(
                EditVertexPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    operation: try container.decode(VertexOperation.self, forKey: .operation),
                    ringIndex: try container.decode(Int.self, forKey: .ringIndex),
                    vertexIndex: try container.decode(Int.self, forKey: .vertexIndex),
                    position: try container.decodeIfPresent(Position.self, forKey: .position)
                )
            )

        case .splitLinework:
            self = .splitLinework(
                SplitLineworkPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    resultObjectIds: try container.decode(
                        SplitResultObjectIds.self, forKey: .resultObjectIds
                    ),
                    atVertexIndex: try container.decode(Int.self, forKey: .atVertexIndex)
                )
            )

        case .joinLinework:
            self = .joinLinework(
                JoinLineworkPayload(
                    firstObjectId: try container.decode(String.self, forKey: .firstObjectId),
                    firstExpectedRevision: try container.decode(
                        Int.self, forKey: .firstExpectedRevision
                    ),
                    secondObjectId: try container.decode(String.self, forKey: .secondObjectId),
                    secondExpectedRevision: try container.decode(
                        Int.self, forKey: .secondExpectedRevision
                    ),
                    resultObjectId: try container.decode(String.self, forKey: .resultObjectId)
                )
            )

        case .changeProperties:
            self = .changeProperties(
                ChangePropertiesPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    label: try container.decodeIfPresent(String.self, forKey: .label),
                    categoryDetails: try container.decodeIfPresent(
                        GardenObjectDetails.self, forKey: .categoryDetails
                    )
                )
            )

        case .assignPlant:
            self = .assignPlant(
                AssignPlantPayload(
                    plantObjectId: try container.decode(String.self, forKey: .plantObjectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision),
                    targetObjectId: try container.decodeIfPresent(
                        String.self, forKey: .targetObjectId
                    )
                )
            )

        case .upsertCalibration:
            self = .upsertCalibration(
                UpsertCalibrationPayload(
                    backgroundObjectId: try container.decode(
                        String.self, forKey: .backgroundObjectId
                    ),
                    referencePoints: try container.decode(
                        [CalibrationReferencePoint].self, forKey: .referencePoints
                    )
                )
            )

        case .decideProposal:
            self = .decideProposal(
                DecideProposalPayload(
                    proposalId: try container.decode(String.self, forKey: .proposalId),
                    decision: try container.decode(ProposalDecision.self, forKey: .decision),
                    editedGeometry: try container.decodeIfPresent(
                        Geometry.self, forKey: .editedGeometry
                    )
                )
            )

        case .deleteObject:
            self = .deleteObject(
                DeleteObjectPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision)
                )
            )

        case .restoreObject:
            self = .restoreObject(
                RestoreObjectPayload(
                    objectId: try container.decode(String.self, forKey: .objectId),
                    expectedRevision: try container.decode(Int.self, forKey: .expectedRevision)
                )
            )

        case .duplicateObject:
            self = .duplicateObject(
                DuplicateObjectPayload(
                    sourceObjectId: try container.decode(String.self, forKey: .sourceObjectId),
                    newObjectId: try container.decode(String.self, forKey: .newObjectId),
                    offsetMetres: try container.decode(PlanarOffset.self, forKey: .offsetMetres)
                )
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)

        switch self {
        case let .createObject(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.category, forKey: .category)
            try container.encode(payload.geometry, forKey: .geometry)
            try container.encodeIfPresent(payload.label, forKey: .label)
            try container.encodeIfPresent(payload.categoryDetails, forKey: .categoryDetails)

        case let .moveObject(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            try container.encode(payload.translationMetres, forKey: .translationMetres)

        case let .replaceGeometry(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            try container.encode(payload.geometry, forKey: .geometry)

        case let .editVertex(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            try container.encode(payload.operation, forKey: .operation)
            try container.encode(payload.ringIndex, forKey: .ringIndex)
            try container.encode(payload.vertexIndex, forKey: .vertexIndex)
            try container.encodeIfPresent(payload.position, forKey: .position)

        case let .splitLinework(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            try container.encode(payload.resultObjectIds, forKey: .resultObjectIds)
            try container.encode(payload.atVertexIndex, forKey: .atVertexIndex)

        case let .joinLinework(payload):
            try container.encode(payload.firstObjectId, forKey: .firstObjectId)
            try container.encode(payload.firstExpectedRevision, forKey: .firstExpectedRevision)
            try container.encode(payload.secondObjectId, forKey: .secondObjectId)
            try container.encode(payload.secondExpectedRevision, forKey: .secondExpectedRevision)
            try container.encode(payload.resultObjectId, forKey: .resultObjectId)

        case let .changeProperties(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            try container.encodeIfPresent(payload.label, forKey: .label)
            try container.encodeIfPresent(payload.categoryDetails, forKey: .categoryDetails)

        case let .assignPlant(payload):
            try container.encode(payload.plantObjectId, forKey: .plantObjectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)
            // `targetObjectId` is `string | null` in TypeScript — always
            // present, never omitted — unlike an optional `field?` member, so
            // this uses `encode`, not `encodeIfPresent`, to write an explicit
            // JSON `null` rather than dropping the key.
            try container.encode(payload.targetObjectId, forKey: .targetObjectId)

        case let .upsertCalibration(payload):
            try container.encode(payload.backgroundObjectId, forKey: .backgroundObjectId)
            try container.encode(payload.referencePoints, forKey: .referencePoints)

        case let .decideProposal(payload):
            try container.encode(payload.proposalId, forKey: .proposalId)
            try container.encode(payload.decision, forKey: .decision)
            try container.encodeIfPresent(payload.editedGeometry, forKey: .editedGeometry)

        case let .deleteObject(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)

        case let .restoreObject(payload):
            try container.encode(payload.objectId, forKey: .objectId)
            try container.encode(payload.expectedRevision, forKey: .expectedRevision)

        case let .duplicateObject(payload):
            try container.encode(payload.sourceObjectId, forKey: .sourceObjectId)
            try container.encode(payload.newObjectId, forKey: .newObjectId)
            try container.encode(payload.offsetMetres, forKey: .offsetMetres)
        }
    }
}

/// GeoJSON-style 2-element array coding for ``SplitResultObjectIds``, matching
/// how `Position` codes as a bare 2-element array in `GeometryCoding.swift`.
extension SplitResultObjectIds: Codable {
    public init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        let first = try container.decode(String.self)
        let second = try container.decode(String.self)

        guard container.isAtEnd else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "resultObjectIds must contain exactly two object identifiers."
            )
        }

        self.init(first: first, second: second)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(first)
        try container.encode(second)
    }
}
