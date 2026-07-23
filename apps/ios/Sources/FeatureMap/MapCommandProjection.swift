import CoreDomain
import Foundation

/// Computes the optimistic local projection of one map command: the
/// `GardenMapObject`(s) it affects, in exactly the shape
/// `MapCommandResult.affectedObjects` would eventually carry once the server
/// confirms the same command — which is what lets
/// `MapEditorViewModel.foldAffectedObjects(_:)` fold either one in through
/// the same code path.
///
/// Added in P5-IOS-02 (Stage 4b). Before this stage, every one of the 13 map
/// commands only ever updated local state *after* a confirmed server
/// response (`MapEditorViewModelEditing.swift`'s own prior doc comment: "this
/// pass has no optimistic local mutation") — gesture preview and the
/// commands built from it (`MapShapeTransform`, `MapVertexEditCommands`,
/// `MapGestureCommands`) compute a *candidate* geometry to send, but nothing
/// previously computed what applying a command actually *produces* without a
/// round trip. This type is that missing piece, mirroring two authoritative
/// sources exactly rather than inventing new semantics:
///
/// - The backend's own geometry primitives
///   (`services/api/.../domain/geometry-edit.ts`: `translateGeometry`,
///   `applyVertexOperation`, `splitLineString`, `joinLineStrings`) for every
///   geometry transform.
/// - The backend's own per-command handlers
///   (`services/api/.../application/*.ts`) for which fields carry over
///   unchanged and which `affectedObjects` shape each command produces —
///   notably that `splitLinework`/`joinLinework` both return the now-deleted
///   source object(s) *and* the new piece(s), three objects each, not the
///   two `CoreDomain.MapCommandResult`'s own (pre-existing, not entirely
///   accurate) doc comment suggests.
///
/// A locally-applied command never advances `revision`: the field always
/// carries forward from `current`'s already-confirmed value (or the
/// unconfirmed sentinel for a brand-new object — see `unconfirmedObjectRevision`),
/// never a locally invented guess. This is deliberate, mirroring
/// `FeatureGardens`'s identical choice for `CreateGarden`/`RenameGarden`/etc:
/// the next command chained locally against the same object must still quote
/// the *last server-confirmed* revision as its own `expectedRevision`, since
/// that is what the server still has until a real push engine confirms this
/// command. Bumping the local revision optimistically would make every
/// subsequent locally-queued command against that object guaranteed to
/// conflict once actually pushed.
enum MapCommandProjection {
    /// Applies `command` against `objectsById` — every object this device
    /// currently has a local row for, active or deleted, for the command's
    /// garden — and returns the object(s) it affects. Throws `MapCommandError`
    /// for a structural precondition the command's own construction cannot
    /// have already ruled out (a missing target object, an out-of-range
    /// vertex/ring index, a category mismatch) — never for a stale
    /// `expectedRevision`, which this store does not check locally, matching
    /// `FeatureGardens`'s identical choice: revision staleness is the
    /// server's discovery to make once this operation is actually pushed
    /// (P5-CONFLICT-01), not this transaction's.
    static func apply(
        _ command: MapCommandPayload,
        to objectsById: [String: GardenMapObject],
        gardenId: String,
        coordinateSpaceId: String,
        now: Date
    ) throws -> [GardenMapObject] {
        switch command {
        case let .createObject(payload):
            return [
                GardenMapObject(
                    id: payload.objectId,
                    gardenId: gardenId,
                    category: payload.category,
                    geometry: payload.geometry,
                    coordinateSpaceId: coordinateSpaceId,
                    label: payload.label,
                    categoryDetails: payload.categoryDetails,
                    lifecycleState: .active,
                    revision: unconfirmedObjectRevision,
                    createdAt: now,
                    updatedAt: now
                )
            ]

        case let .moveObject(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            let geometry = translated(object.geometry, dx: payload.translationMetres.dx, dy: payload.translationMetres.dy)
            return [withGeometry(object, geometry, at: now)]

        case let .replaceGeometry(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            return [withGeometry(object, payload.geometry, at: now)]

        case let .editVertex(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            guard payload.ringIndex == 0 else { throw MapCommandError.invalidGeometryOperation }

            let updatedGeometry: Geometry?
            switch payload.operation {
            case .insert:
                guard let position = payload.position else { throw MapCommandError.invalidGeometryOperation }
                updatedGeometry = MapVertexEditCommands.insertingVertex(
                    in: object.geometry, vertexIndex: payload.vertexIndex, position: position
                )
            case .move:
                guard let position = payload.position else { throw MapCommandError.invalidGeometryOperation }
                updatedGeometry = MapVertexEditCommands.movingVertex(
                    in: object.geometry, vertexIndex: payload.vertexIndex, to: position
                )
            case .remove:
                updatedGeometry = MapVertexEditCommands.removingVertex(in: object.geometry, vertexIndex: payload.vertexIndex)
            }

            guard let updatedGeometry else { throw MapCommandError.invalidGeometryOperation }
            return [withGeometry(object, updatedGeometry, at: now)]

        case let .splitLinework(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            guard case let .lineString(positions) = object.geometry,
                payload.atVertexIndex > 0, payload.atVertexIndex < positions.count - 1
            else {
                throw MapCommandError.invalidGeometryOperation
            }

            let firstGeometry = Geometry.lineString(Array(positions[0...payload.atVertexIndex]))
            let secondGeometry = Geometry.lineString(Array(positions[payload.atVertexIndex...]))
            let first = clone(object, id: payload.resultObjectIds.first, geometry: firstGeometry, at: now)
            let second = clone(object, id: payload.resultObjectIds.second, geometry: secondGeometry, at: now)
            let deletedOriginal = withLifecycle(object, .deleted, at: now)

            // Matches the backend's own `affectedObjects` order exactly
            // (`SplitMapObjectLinework.execute`): the deleted original first,
            // then the two new pieces.
            return [deletedOriginal, first, second]

        case let .joinLinework(payload):
            let first = try requireObject(payload.firstObjectId, in: objectsById)
            let second = try requireObject(payload.secondObjectId, in: objectsById)
            guard first.category == second.category else { throw MapCommandError.categoryMismatch }
            guard case let .lineString(firstPositions) = first.geometry, case let .lineString(secondPositions) = second.geometry
            else {
                throw MapCommandError.invalidGeometryOperation
            }

            let joinedGeometry = Geometry.lineString(joined(firstPositions, secondPositions))
            let joinedObject = clone(first, id: payload.resultObjectId, geometry: joinedGeometry, at: now)
            let deletedFirst = withLifecycle(first, .deleted, at: now)
            let deletedSecond = withLifecycle(second, .deleted, at: now)

            // Matches the backend's own `affectedObjects` order exactly
            // (`JoinMapObjectLinework.execute`).
            return [deletedFirst, deletedSecond, joinedObject]

        case let .changeProperties(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            let snapshot = ObjectSnapshot(
                objectId: object.id,
                category: object.category,
                geometry: object.geometry,
                label: payload.label,
                categoryDetails: payload.categoryDetails,
                lifecycleState: object.lifecycleState
            )
            return [object.replacingSnapshot(snapshot, revision: object.revision, updatedAt: now)]

        case let .assignPlant(payload):
            let object = try requireObject(payload.plantObjectId, in: objectsById)
            guard case let .plant(details)? = object.categoryDetails else { throw MapCommandError.notAPlant }

            let updatedDetails = PlantPlacementDetails(
                commonName: details.commonName,
                quantity: details.quantity,
                spacingMetres: details.spacingMetres,
                assignedToObjectId: payload.targetObjectId
            )
            return [withDetails(object, .plant(updatedDetails), at: now)]

        case let .deleteObject(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            return [withLifecycle(object, .deleted, at: now)]

        case let .restoreObject(payload):
            let object = try requireObject(payload.objectId, in: objectsById)
            return [withLifecycle(object, .active, at: now)]

        case let .duplicateObject(payload):
            let source = try requireObject(payload.sourceObjectId, in: objectsById)
            let geometry = translated(source.geometry, dx: payload.offsetMetres.dx, dy: payload.offsetMetres.dy)
            let duplicate = GardenMapObject(
                id: payload.newObjectId,
                gardenId: source.gardenId,
                category: source.category,
                geometry: geometry,
                coordinateSpaceId: source.coordinateSpaceId,
                label: source.label,
                categoryDetails: source.categoryDetails,
                lifecycleState: .active,
                revision: unconfirmedObjectRevision,
                createdAt: now,
                updatedAt: now
            )
            return [duplicate]

        case .upsertCalibration, .decideProposal:
            throw MapCommandError.unsupportedCommand
        }
    }

    /// The `expectedRevision` `ApplyMapCommandOffline` stores on the outbox
    /// operation as local bookkeeping (architecture/offline-
    /// synchronization.md, section "7. Outbox Operation") — `nil` for a
    /// command with none, and for `joinLinework` (which carries two) the
    /// first object's, a documented simplification: this field is never
    /// consulted on the wire (`SyncGardenObjectOperationPayload.command`
    /// already carries both revisions; see that schema's own description in
    /// `packages/api-contracts/openapi.yaml`), only for local observability.
    static func primaryExpectedRevision(for command: MapCommandPayload) -> Int? {
        switch command {
        case .createObject, .duplicateObject, .upsertCalibration, .decideProposal:
            nil
        case let .moveObject(payload): payload.expectedRevision
        case let .replaceGeometry(payload): payload.expectedRevision
        case let .editVertex(payload): payload.expectedRevision
        case let .splitLinework(payload): payload.expectedRevision
        case let .joinLinework(payload): payload.firstExpectedRevision
        case let .changeProperties(payload): payload.expectedRevision
        case let .assignPlant(payload): payload.expectedRevision
        case let .deleteObject(payload): payload.expectedRevision
        case let .restoreObject(payload): payload.expectedRevision
        }
    }

    private static func requireObject(_ objectId: String, in objectsById: [String: GardenMapObject]) throws -> GardenMapObject {
        guard let object = objectsById[objectId] else { throw MapCommandError.objectNotFound(objectId: objectId) }
        return object
    }

    private static func withGeometry(_ object: GardenMapObject, _ geometry: Geometry, at now: Date) -> GardenMapObject {
        object.replacingSnapshot(
            ObjectSnapshot(
                objectId: object.id,
                category: object.category,
                geometry: geometry,
                label: object.label,
                categoryDetails: object.categoryDetails,
                lifecycleState: object.lifecycleState
            ),
            revision: object.revision,
            updatedAt: now
        )
    }

    private static func withDetails(_ object: GardenMapObject, _ categoryDetails: GardenObjectDetails?, at now: Date) -> GardenMapObject {
        object.replacingSnapshot(
            ObjectSnapshot(
                objectId: object.id,
                category: object.category,
                geometry: object.geometry,
                label: object.label,
                categoryDetails: categoryDetails,
                lifecycleState: object.lifecycleState
            ),
            revision: object.revision,
            updatedAt: now
        )
    }

    private static func withLifecycle(_ object: GardenMapObject, _ lifecycleState: ObjectLifecycleState, at now: Date) -> GardenMapObject {
        object.replacingSnapshot(
            ObjectSnapshot(
                objectId: object.id,
                category: object.category,
                geometry: object.geometry,
                label: object.label,
                categoryDetails: object.categoryDetails,
                lifecycleState: lifecycleState
            ),
            revision: object.revision,
            updatedAt: now
        )
    }

    /// A new object at `id`, carrying `source`'s category/coordinate space/
    /// label/categoryDetails forward at the given `geometry` — the shared
    /// shape `splitLinework`'s two pieces and `joinLinework`'s merged result
    /// both produce, mirroring the backend's own `{ ...source, id, geometry,
    /// ... }` spread in `split-map-object-linework.ts`/
    /// `join-map-object-linework.ts`.
    private static func clone(_ source: GardenMapObject, id: String, geometry: Geometry, at now: Date) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: source.gardenId,
            category: source.category,
            geometry: geometry,
            coordinateSpaceId: source.coordinateSpaceId,
            label: source.label,
            categoryDetails: source.categoryDetails,
            lifecycleState: .active,
            revision: unconfirmedObjectRevision,
            createdAt: now,
            updatedAt: now
        )
    }

    /// `geometry` translated by `(dx, dy)` — the local counterpart of the
    /// backend's `translateGeometry` (`services/api/.../domain/geometry-edit.ts`),
    /// covering every geometry type `moveObject`/`duplicateObject` can carry.
    private static func translated(_ geometry: Geometry, dx: Double, dy: Double) -> Geometry {
        func move(_ position: Position) -> Position {
            Position(x: position.x + dx, y: position.y + dy)
        }

        switch geometry {
        case let .point(position): return .point(move(position))
        case let .lineString(line): return .lineString(line.map(move))
        case let .polygon(rings): return .polygon(rings.map { $0.map(move) })
        case let .multiLineString(lines): return .multiLineString(lines.map { $0.map(move) })
        case let .multiPolygon(polygons): return .multiPolygon(polygons.map { $0.map { $0.map(move) } })
        }
    }

    /// `first` and `second` concatenated, dropping `second`'s first position
    /// when it exactly coincides with `first`'s last — the local counterpart
    /// of the backend's `joinLineStrings` (`services/api/.../domain/geometry-edit.ts`).
    private static func joined(_ first: [Position], _ second: [Position]) -> [Position] {
        guard let lastOfFirst = first.last, let firstOfSecond = second.first, lastOfFirst == firstOfSecond else {
            return first + second
        }
        return first + second.dropFirst()
    }
}

/// A map object created or cloned offline has no server-assigned revision
/// yet. `0` is below the contract's `Revision` minimum of `1`
/// (`packages/api-contracts/openapi.yaml`), so it can never be mistaken for a
/// real server revision — the exact same sentinel and reasoning as
/// `FeatureGardens.GardensUseCases.swift`'s `unconfirmedGardenRevision`.
private let unconfirmedObjectRevision = 0
