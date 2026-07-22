/// The 13 command payload types, one per case of ``MapCommandPayload``.
///
/// None of these carries its own `type` discriminator field — that
/// discriminator is the enclosing enum case itself — and none is directly
/// `Codable`: the flat wire shape (`{"type": ..., <payload fields>}`) is
/// produced centrally by ``MapCommandPayload``'s hand-written coding in
/// `MapCommandCoding.swift`, the same way `GeometryCoding.swift` centralizes
/// ``Geometry``'s coding. Keeping coding out of this file leaves these types
/// free of transport concerns.
///
/// Source: packages/geometry-contracts/src/command.ts.

/// A `{dx, dy}` translation or offset in metres, shared by `moveObject` and
/// `duplicateObject`.
///
/// An anonymous object type in TypeScript; named here because Swift has no
/// anonymous struct literal.
public struct PlanarOffset: Equatable, Sendable, Codable {
    public let dx: Double
    public let dy: Double

    public init(dx: Double, dy: Double) {
        self.dx = dx
        self.dy = dy
    }
}

public struct CreateObjectPayload: Equatable, Sendable {
    public let objectId: String
    public let category: GardenObjectCategory
    public let geometry: Geometry
    public let label: String?
    public let categoryDetails: GardenObjectDetails?

    public init(
        objectId: String,
        category: GardenObjectCategory,
        geometry: Geometry,
        label: String? = nil,
        categoryDetails: GardenObjectDetails? = nil
    ) {
        self.objectId = objectId
        self.category = category
        self.geometry = geometry
        self.label = label
        self.categoryDetails = categoryDetails
    }
}

public struct MoveObjectPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int
    public let translationMetres: PlanarOffset

    public init(objectId: String, expectedRevision: Int, translationMetres: PlanarOffset) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
        self.translationMetres = translationMetres
    }
}

public struct ReplaceGeometryPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int
    public let geometry: Geometry

    public init(objectId: String, expectedRevision: Int, geometry: Geometry) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
        self.geometry = geometry
    }
}

/// Which vertex operation an ``EditVertexPayload`` performs.
public enum VertexOperation: String, Codable, Sendable, CaseIterable {
    case insert
    case move
    case remove
}

public struct EditVertexPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int
    public let operation: VertexOperation
    /// Which ring of a Polygon/MultiPolygon; 0 for LineString/Point geometries.
    public let ringIndex: Int
    public let vertexIndex: Int
    /// Required for `insert` and `move`; absent for `remove`.
    public let position: Position?

    public init(
        objectId: String,
        expectedRevision: Int,
        operation: VertexOperation,
        ringIndex: Int,
        vertexIndex: Int,
        position: Position? = nil
    ) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
        self.operation = operation
        self.ringIndex = ringIndex
        self.vertexIndex = vertexIndex
        self.position = position
    }
}

/// New object identifiers for the two pieces produced by a `splitLinework`
/// command, in original line order.
///
/// The TypeScript type is a 2-tuple (`readonly [string, string]`); Swift
/// tuples cannot conform to `Equatable` or `Codable`, so this is a small
/// named struct instead, coded as a 2-element JSON array in
/// `MapCommandCoding.swift` the same way `Position` codes as a 2-element
/// array in `GeometryCoding.swift`.
public struct SplitResultObjectIds: Equatable, Sendable {
    public let first: String
    public let second: String

    public init(first: String, second: String) {
        self.first = first
        self.second = second
    }
}

public struct SplitLineworkPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int
    public let resultObjectIds: SplitResultObjectIds
    public let atVertexIndex: Int

    public init(
        objectId: String,
        expectedRevision: Int,
        resultObjectIds: SplitResultObjectIds,
        atVertexIndex: Int
    ) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
        self.resultObjectIds = resultObjectIds
        self.atVertexIndex = atVertexIndex
    }
}

public struct JoinLineworkPayload: Equatable, Sendable {
    public let firstObjectId: String
    public let firstExpectedRevision: Int
    public let secondObjectId: String
    public let secondExpectedRevision: Int
    public let resultObjectId: String

    public init(
        firstObjectId: String,
        firstExpectedRevision: Int,
        secondObjectId: String,
        secondExpectedRevision: Int,
        resultObjectId: String
    ) {
        self.firstObjectId = firstObjectId
        self.firstExpectedRevision = firstExpectedRevision
        self.secondObjectId = secondObjectId
        self.secondExpectedRevision = secondExpectedRevision
        self.resultObjectId = resultObjectId
    }
}

public struct ChangePropertiesPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int
    public let label: String?
    public let categoryDetails: GardenObjectDetails?

    public init(
        objectId: String,
        expectedRevision: Int,
        label: String? = nil,
        categoryDetails: GardenObjectDetails? = nil
    ) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
        self.label = label
        self.categoryDetails = categoryDetails
    }
}

public struct AssignPlantPayload: Equatable, Sendable {
    public let plantObjectId: String
    public let expectedRevision: Int
    /// `nil` unassigns the plant from any zone or bed.
    public let targetObjectId: String?

    public init(plantObjectId: String, expectedRevision: Int, targetObjectId: String?) {
        self.plantObjectId = plantObjectId
        self.expectedRevision = expectedRevision
        self.targetObjectId = targetObjectId
    }
}

/// One correspondence between an image pixel and a local-metres position,
/// used to calibrate an imported background plan.
public struct CalibrationReferencePoint: Equatable, Sendable, Codable {
    public let imagePixel: Position
    public let localMetres: Position

    public init(imagePixel: Position, localMetres: Position) {
        self.imagePixel = imagePixel
        self.localMetres = localMetres
    }
}

public struct UpsertCalibrationPayload: Equatable, Sendable {
    public let backgroundObjectId: String
    public let referencePoints: [CalibrationReferencePoint]

    public init(backgroundObjectId: String, referencePoints: [CalibrationReferencePoint]) {
        self.backgroundObjectId = backgroundObjectId
        self.referencePoints = referencePoints
    }
}

/// The decision a user makes on a system-generated proposal.
public enum ProposalDecision: String, Codable, Sendable, CaseIterable {
    case accept
    case modifyAndAccept
    case reject
}

public struct DecideProposalPayload: Equatable, Sendable {
    public let proposalId: String
    public let decision: ProposalDecision
    /// Required only for `modifyAndAccept`.
    public let editedGeometry: Geometry?

    public init(proposalId: String, decision: ProposalDecision, editedGeometry: Geometry? = nil) {
        self.proposalId = proposalId
        self.decision = decision
        self.editedGeometry = editedGeometry
    }
}

public struct DeleteObjectPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int

    public init(objectId: String, expectedRevision: Int) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
    }
}

public struct RestoreObjectPayload: Equatable, Sendable {
    public let objectId: String
    public let expectedRevision: Int

    public init(objectId: String, expectedRevision: Int) {
        self.objectId = objectId
        self.expectedRevision = expectedRevision
    }
}

public struct DuplicateObjectPayload: Equatable, Sendable {
    public let sourceObjectId: String
    public let newObjectId: String
    public let offsetMetres: PlanarOffset

    public init(sourceObjectId: String, newObjectId: String, offsetMetres: PlanarOffset) {
        self.sourceObjectId = sourceObjectId
        self.newObjectId = newObjectId
        self.offsetMetres = offsetMetres
    }
}
