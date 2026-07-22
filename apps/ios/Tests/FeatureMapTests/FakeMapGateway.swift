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

        case .replaceGeometry, .editVertex, .splitLinework, .joinLinework, .assignPlant, .upsertCalibration,
            .decideProposal, .duplicateObject:
            // Not issued by MapEditorViewModel in this pass — see its own
            // and MapGestureCommands's doc comments on scope.
            throw APIGatewayError.unexpectedStatus(501, correlationId: "fake-unsupported")
        }
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
