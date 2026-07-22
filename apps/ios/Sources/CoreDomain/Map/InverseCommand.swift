/// Deterministic local undo.
///
/// Section "9. Undo and Redo" of the map design: "Undo creates the inverse
/// domain command; it does not rewind the database... Once synchronized, undo
/// remains a new explicit change." The inverse this module derives is
/// therefore an ordinary new ``MapCommandPayload``, not a special "undo" API
/// — it carries the revision the object had immediately after the original
/// command, since that is what the server now expects as the base for the
/// next command.
///
/// Not every command type inverts as a single deterministic command, and this
/// is a property of the domain, not a gap in this function: the design
/// explicitly special-cases proposal acceptance ("can be undone through
/// revision restoration, not by deleting processing history") and split/join
/// linework recreate object identity in a way a single inverse command cannot
/// express. Those cases return `nil` on purpose — the editor's undo stack
/// must treat `nil` as "not locally undoable this way," not as an error.
///
/// Source: architecture/map-rendering-and-editing.md, section
/// "9. Undo and Redo"; packages/geometry-contracts/src/inverse-command.ts.

public enum ObjectLifecycleState: String, Codable, Sendable, CaseIterable {
    case active
    case deleted
}

/// What the object looked like immediately before a command was applied —
/// exactly what a client already holds before performing its own local
/// optimistic update.
public struct ObjectSnapshot: Equatable, Sendable, Codable {
    public let objectId: String
    public let category: GardenObjectCategory
    public let geometry: Geometry
    public let label: String?
    public let categoryDetails: GardenObjectDetails?
    public let lifecycleState: ObjectLifecycleState

    public init(
        objectId: String,
        category: GardenObjectCategory,
        geometry: Geometry,
        label: String? = nil,
        categoryDetails: GardenObjectDetails? = nil,
        lifecycleState: ObjectLifecycleState
    ) {
        self.objectId = objectId
        self.category = category
        self.geometry = geometry
        self.label = label
        self.categoryDetails = categoryDetails
        self.lifecycleState = lifecycleState
    }
}

/// The positions of one ring/line of a geometry, addressed the way
/// ``EditVertexPayload`` addresses vertices.
///
/// `MultiPolygon` has no single-ring addressing in the foundation release, so
/// it flattens across polygons instead — matching the TypeScript
/// counterpart's own comment — via ``Geometry/positions``.
private func ringOf(_ geometry: Geometry, ringIndex: Int) -> [Position] {
    switch geometry {
    case let .point(position):
        return [position]
    case let .lineString(line):
        return line
    case let .multiLineString(lines):
        return ringIndex >= 0 && ringIndex < lines.count ? lines[ringIndex] : []
    case let .polygon(rings):
        return ringIndex >= 0 && ringIndex < rings.count ? rings[ringIndex] : []
    case .multiPolygon:
        return geometry.positions
    }
}

/// Derives the inverse of a single command, given the object's state
/// immediately before the command and the revision the server assigned after
/// applying it (the base the inverse must target).
///
/// Returns `nil` when the command type has no single-command inverse — see
/// the module doc comment.
public func deriveInverseCommand(
    command: MapCommandPayload,
    priorSnapshot: ObjectSnapshot?,
    revisionAfterCommand: Int
) -> MapCommandPayload? {
    switch command {
    case let .createObject(payload):
        return .deleteObject(
            DeleteObjectPayload(objectId: payload.objectId, expectedRevision: revisionAfterCommand)
        )

    case let .duplicateObject(payload):
        return .deleteObject(
            DeleteObjectPayload(
                objectId: payload.newObjectId, expectedRevision: revisionAfterCommand
            )
        )

    case let .moveObject(payload):
        return .moveObject(
            MoveObjectPayload(
                objectId: payload.objectId,
                expectedRevision: revisionAfterCommand,
                translationMetres: PlanarOffset(
                    dx: -payload.translationMetres.dx,
                    dy: -payload.translationMetres.dy
                )
            )
        )

    case let .replaceGeometry(payload):
        guard let priorSnapshot else { return nil }
        return .replaceGeometry(
            ReplaceGeometryPayload(
                objectId: payload.objectId,
                expectedRevision: revisionAfterCommand,
                geometry: priorSnapshot.geometry
            )
        )

    case let .editVertex(payload):
        guard let priorSnapshot else { return nil }
        let priorRing = ringOf(priorSnapshot.geometry, ringIndex: payload.ringIndex)

        if payload.operation == .insert {
            return .editVertex(
                EditVertexPayload(
                    objectId: payload.objectId,
                    expectedRevision: revisionAfterCommand,
                    operation: .remove,
                    ringIndex: payload.ringIndex,
                    vertexIndex: payload.vertexIndex
                )
            )
        }

        guard payload.vertexIndex >= 0, payload.vertexIndex < priorRing.count else { return nil }
        let priorPosition = priorRing[payload.vertexIndex]

        if payload.operation == .move {
            return .editVertex(
                EditVertexPayload(
                    objectId: payload.objectId,
                    expectedRevision: revisionAfterCommand,
                    operation: .move,
                    ringIndex: payload.ringIndex,
                    vertexIndex: payload.vertexIndex,
                    position: priorPosition
                )
            )
        }

        // payload.operation == .remove
        return .editVertex(
            EditVertexPayload(
                objectId: payload.objectId,
                expectedRevision: revisionAfterCommand,
                operation: .insert,
                ringIndex: payload.ringIndex,
                vertexIndex: payload.vertexIndex,
                position: priorPosition
            )
        )

    case let .changeProperties(payload):
        guard let priorSnapshot else { return nil }
        return .changeProperties(
            ChangePropertiesPayload(
                objectId: payload.objectId,
                expectedRevision: revisionAfterCommand,
                label: priorSnapshot.label,
                categoryDetails: priorSnapshot.categoryDetails
            )
        )

    case let .assignPlant(payload):
        guard let priorSnapshot else { return nil }
        let priorTarget: String?
        if case let .plant(details)? = priorSnapshot.categoryDetails {
            priorTarget = details.assignedToObjectId
        } else {
            priorTarget = nil
        }
        return .assignPlant(
            AssignPlantPayload(
                plantObjectId: payload.plantObjectId,
                expectedRevision: revisionAfterCommand,
                targetObjectId: priorTarget
            )
        )

    case let .deleteObject(payload):
        return .restoreObject(
            RestoreObjectPayload(objectId: payload.objectId, expectedRevision: revisionAfterCommand)
        )

    case let .restoreObject(payload):
        return .deleteObject(
            DeleteObjectPayload(objectId: payload.objectId, expectedRevision: revisionAfterCommand)
        )

    // Split and join recreate object identity in ways a single inverse
    // command cannot express; calibration and proposal decisions are
    // explicitly excluded from single-command undo by the design itself.
    // See the module doc comment.
    case .splitLinework, .joinLinework, .upsertCalibration, .decideProposal:
        return nil
    }
}
