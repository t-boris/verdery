import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the real API.
///
/// Mirrors just enough of the backend's revision-guarded command semantics
/// (architecture/map-rendering-and-editing.md, section "7. Editor Command
/// Model") to make `MapEditorViewModelTests` meaningful: every command that
/// carries `expectedRevision` is rejected when it does not match current
/// state, exactly like the real service — a test built against a gateway
/// that always accepts commands could not tell a correct undo/redo
/// implementation from a broken one.
final class FakeMapGateway: MapGateway, @unchecked Sendable {
    private var objects: [String: GardenMapObject]
    private(set) var submittedCommands: [MapCommandPayload] = []
    var georeference: GardenGeoreference?

    init(objects: [GardenMapObject] = []) {
        self.objects = Dictionary(uniqueKeysWithValues: objects.map { ($0.id, $0) })
    }

    func getMap(gardenId: String) async throws -> GardenMapDocument {
        GardenMapDocument(
            coordinateSpaceId: "space-1",
            georeference: georeference,
            objects: objects.values.filter { $0.lifecycleState == .active }.sorted { $0.id < $1.id }
        )
    }

    func submitCommand(
        gardenId: String,
        command: MapCommandPayload,
        idempotencyKey: String
    ) async throws -> MapCommandResult {
        submittedCommands.append(command)

        switch command {
        case let .createObject(payload):
            let object = GardenMapObject(
                id: payload.objectId,
                gardenId: gardenId,
                category: payload.category,
                geometry: payload.geometry,
                coordinateSpaceId: "space-1",
                label: payload.label,
                categoryDetails: payload.categoryDetails,
                lifecycleState: .active,
                revision: 1,
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            )
            objects[object.id] = object
            return MapCommandResult(affectedObjects: [object])

        case let .moveObject(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let moved = GardenMapObject(
                id: object.id,
                gardenId: object.gardenId,
                category: object.category,
                geometry: translated(object.geometry, by: payload.translationMetres),
                coordinateSpaceId: object.coordinateSpaceId,
                label: object.label,
                categoryDetails: object.categoryDetails,
                lifecycleState: object.lifecycleState,
                revision: object.revision + 1,
                createdAt: object.createdAt,
                updatedAt: object.createdAt
            )
            objects[object.id] = moved
            return MapCommandResult(affectedObjects: [moved])

        case let .changeProperties(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let updated = GardenMapObject(
                id: object.id,
                gardenId: object.gardenId,
                category: object.category,
                geometry: object.geometry,
                coordinateSpaceId: object.coordinateSpaceId,
                label: payload.label,
                categoryDetails: payload.categoryDetails,
                lifecycleState: object.lifecycleState,
                revision: object.revision + 1,
                createdAt: object.createdAt,
                updatedAt: object.createdAt
            )
            objects[object.id] = updated
            return MapCommandResult(affectedObjects: [updated])

        case let .deleteObject(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let deleted = withLifecycle(object, .deleted)
            objects[object.id] = deleted
            return MapCommandResult(affectedObjects: [deleted])

        case let .restoreObject(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let restored = withLifecycle(object, .active)
            objects[object.id] = restored
            return MapCommandResult(affectedObjects: [restored])

        case let .replaceGeometry(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let updated = withGeometry(object, payload.geometry)
            objects[object.id] = updated
            return MapCommandResult(affectedObjects: [updated])

        case let .editVertex(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            let geometry = try applyVertexOperation(
                object.geometry,
                ringIndex: payload.ringIndex,
                vertexIndex: payload.vertexIndex,
                operation: payload.operation,
                position: payload.position
            )
            let updated = withGeometry(object, geometry)
            objects[object.id] = updated
            return MapCommandResult(affectedObjects: [updated])

        case let .duplicateObject(payload):
            guard let source = objects[payload.sourceObjectId] else {
                throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-missing-source")
            }
            let duplicated = GardenMapObject(
                id: payload.newObjectId,
                gardenId: source.gardenId,
                category: source.category,
                geometry: translated(source.geometry, by: payload.offsetMetres),
                coordinateSpaceId: source.coordinateSpaceId,
                label: source.label,
                categoryDetails: source.categoryDetails,
                lifecycleState: .active,
                revision: 1,
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            )
            objects[duplicated.id] = duplicated
            return MapCommandResult(affectedObjects: [duplicated])

        case let .assignPlant(payload):
            let object = try expectRevision(payload.plantObjectId, payload.expectedRevision)
            guard case let .plant(details)? = object.categoryDetails else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-not-a-plant")
            }
            let updatedDetails = PlantPlacementDetails(
                commonName: details.commonName,
                quantity: details.quantity,
                spacingMetres: details.spacingMetres,
                assignedToObjectId: payload.targetObjectId
            )
            let updated = withDetails(object, .plant(updatedDetails))
            objects[object.id] = updated
            return MapCommandResult(affectedObjects: [updated])

        case let .splitLinework(payload):
            let object = try expectRevision(payload.objectId, payload.expectedRevision)
            guard case let .lineString(positions) = object.geometry,
                payload.atVertexIndex > 0, payload.atVertexIndex < positions.count - 1
            else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-split-out-of-range")
            }
            let firstGeometry = Geometry.lineString(Array(positions[0...payload.atVertexIndex]))
            let secondGeometry = Geometry.lineString(Array(positions[payload.atVertexIndex...]))
            let first = pieceFrom(object, id: payload.resultObjectIds.first, geometry: firstGeometry)
            let second = pieceFrom(object, id: payload.resultObjectIds.second, geometry: secondGeometry)
            let deletedOriginal = withLifecycle(object, .deleted)
            objects[object.id] = deletedOriginal
            objects[first.id] = first
            objects[second.id] = second
            // The new pieces come first so `foldAffectedObjects`'s "first
            // affected object" convenience — what the view model selects on
            // success — lands on a real piece, not the now-deleted original;
            // the deleted original is still included so the client's local
            // state (not just the server's) reflects it disappearing from
            // the active set.
            return MapCommandResult(affectedObjects: [first, second, deletedOriginal])

        case let .joinLinework(payload):
            let first = try expectRevision(payload.firstObjectId, payload.firstExpectedRevision)
            let second = try expectRevision(payload.secondObjectId, payload.secondExpectedRevision)
            guard case let .lineString(firstPositions) = first.geometry,
                case let .lineString(secondPositions) = second.geometry
            else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-join-requires-linestring")
            }
            let overlaps = firstPositions.last == secondPositions.first
            let joinedPositions = overlaps ? firstPositions + secondPositions.dropFirst() : firstPositions + secondPositions
            let joined = pieceFrom(first, id: payload.resultObjectId, geometry: .lineString(joinedPositions))
            let deletedFirst = withLifecycle(first, .deleted)
            let deletedSecond = withLifecycle(second, .deleted)
            objects[first.id] = deletedFirst
            objects[second.id] = deletedSecond
            objects[joined.id] = joined
            // `joined` first for the same reason as `splitLinework` above.
            return MapCommandResult(affectedObjects: [joined, deletedFirst, deletedSecond])

        case .upsertCalibration, .decideProposal:
            // Genuinely out of scope this pass — see MapGestureCommands's and
            // MapObjectPropertyView's doc comments; nothing in this app
            // creates an `importedBackground` object or a proposal for these
            // to operate against.
            throw APIGatewayError.unexpectedStatus(501, correlationId: "fake-unsupported")
        }
    }

    /// A new object carrying `previous`'s category/details/coordinate space
    /// at a fresh revision — the shared shape `splitLinework` and
    /// `joinLinework` both produce.
    private func pieceFrom(_ previous: GardenMapObject, id: String, geometry: Geometry) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: previous.gardenId,
            category: previous.category,
            geometry: geometry,
            coordinateSpaceId: previous.coordinateSpaceId,
            label: previous.label,
            categoryDetails: previous.categoryDetails,
            lifecycleState: .active,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func withGeometry(_ object: GardenMapObject, _ geometry: Geometry) -> GardenMapObject {
        GardenMapObject(
            id: object.id,
            gardenId: object.gardenId,
            category: object.category,
            geometry: geometry,
            coordinateSpaceId: object.coordinateSpaceId,
            label: object.label,
            categoryDetails: object.categoryDetails,
            lifecycleState: object.lifecycleState,
            revision: object.revision + 1,
            createdAt: object.createdAt,
            updatedAt: object.createdAt
        )
    }

    private func withDetails(_ object: GardenMapObject, _ details: GardenObjectDetails?) -> GardenMapObject {
        GardenMapObject(
            id: object.id,
            gardenId: object.gardenId,
            category: object.category,
            geometry: object.geometry,
            coordinateSpaceId: object.coordinateSpaceId,
            label: object.label,
            categoryDetails: details,
            lifecycleState: object.lifecycleState,
            revision: object.revision + 1,
            createdAt: object.createdAt,
            updatedAt: object.createdAt
        )
    }

    /// A small, test-only mirror of the real backend's `applyVertexOperation`
    /// (`services/api/.../domain/geometry-edit.ts`): resolves `ringIndex`
    /// against `geometry`'s stored ring/line and applies one vertex
    /// operation to it. Deliberately narrower than the real implementation —
    /// only `LineString` and single-ring `Polygon` are supported, matching
    /// everything this app's client actually sends (see
    /// `MapVertexEditCommands`'s doc comment on scope).
    private func applyVertexOperation(
        _ geometry: Geometry,
        ringIndex: Int,
        vertexIndex: Int,
        operation: VertexOperation,
        position: Position?
    ) throws -> Geometry {
        func rebuild(_ ring: [Position]) throws -> Geometry {
            switch geometry {
            case .lineString:
                return .lineString(ring)
            case var .polygon(rings):
                guard ringIndex >= 0, ringIndex < rings.count else {
                    throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-ring-out-of-range")
                }
                rings[ringIndex] = ring
                return .polygon(rings)
            case .point, .multiLineString, .multiPolygon:
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-unsupported-geometry")
            }
        }

        var ring: [Position]
        switch geometry {
        case let .lineString(line):
            guard ringIndex == 0 else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-ring-out-of-range")
            }
            ring = line
        case let .polygon(rings):
            guard ringIndex >= 0, ringIndex < rings.count else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-ring-out-of-range")
            }
            ring = rings[ringIndex]
        case .point, .multiLineString, .multiPolygon:
            throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-unsupported-geometry")
        }

        switch operation {
        case .insert:
            guard let position, vertexIndex >= 0, vertexIndex <= ring.count else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-vertex-out-of-range")
            }
            ring.insert(position, at: vertexIndex)
        case .move:
            guard let position, vertexIndex >= 0, vertexIndex < ring.count else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-vertex-out-of-range")
            }
            ring[vertexIndex] = position
        case .remove:
            guard vertexIndex >= 0, vertexIndex < ring.count else {
                throw APIGatewayError.unexpectedStatus(400, correlationId: "fake-vertex-out-of-range")
            }
            ring.remove(at: vertexIndex)
        }

        return try rebuild(ring)
    }

    private func expectRevision(_ objectId: String, _ expected: Int) throws -> GardenMapObject {
        guard let object = objects[objectId], object.revision == expected else {
            throw APIGatewayError.unexpectedStatus(409, correlationId: "fake-conflict")
        }
        return object
    }

    private func withLifecycle(_ object: GardenMapObject, _ state: ObjectLifecycleState) -> GardenMapObject {
        GardenMapObject(
            id: object.id,
            gardenId: object.gardenId,
            category: object.category,
            geometry: object.geometry,
            coordinateSpaceId: object.coordinateSpaceId,
            label: object.label,
            categoryDetails: object.categoryDetails,
            lifecycleState: state,
            revision: object.revision + 1,
            createdAt: object.createdAt,
            updatedAt: object.createdAt
        )
    }

    private func translated(_ geometry: Geometry, by offset: PlanarOffset) -> Geometry {
        func move(_ position: Position) -> Position {
            Position(x: position.x + offset.dx, y: position.y + offset.dy)
        }

        switch geometry {
        case let .point(position): return .point(move(position))
        case let .lineString(line): return .lineString(line.map(move))
        case let .polygon(rings): return .polygon(rings.map { $0.map(move) })
        case let .multiLineString(lines): return .multiLineString(lines.map { $0.map(move) })
        case let .multiPolygon(polygons): return .multiPolygon(polygons.map { $0.map { $0.map(move) } })
        }
    }
}
