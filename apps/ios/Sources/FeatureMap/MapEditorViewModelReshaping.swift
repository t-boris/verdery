import CoreDomain
import CoreGraphics
import CoreNetworking

/// Vertex-level reshape (`editVertex`) and whole-shape resize/rotate
/// (`replaceGeometry`) for the object currently in vertex-edit mode.
///
/// Vertex-edit mode is a separate, explicit mode from ordinary selection —
/// entered from the property sheet's "Edit shape" action (`MapObjectPropertyView.swift`)
/// — rather than always-on handles on every selected object, so a plain
/// tap-select never risks an accidental vertex nudge. Scoped to `LineString`
/// and single-ring `Polygon` geometry; see `MapVertexEditCommands`'s doc
/// comment for what is out of scope and why.
///
/// Every commit here follows the same shape as every other mutating action in
/// this feature: build one command from already-known local state, submit it
/// through ``MapEditorViewModel/submit(_:undoBeforeSnapshot:onSuccess:)``
/// with the object's current snapshot as the undo base, and let the server's
/// confirmed result — never a locally computed guess — become the new local
/// geometry.
extension MapEditorViewModel {
    public var vertexEditObject: GardenMapObject? {
        vertexEditObjectId.flatMap { objectsById[$0] }
    }

    /// True when `object`'s geometry is one vertex editing supports — what
    /// the property sheet checks before offering "Edit shape" at all.
    public func supportsVertexEdit(_ object: GardenMapObject) -> Bool {
        MapVertexEditCommands.editableVertices(of: object.geometry) != nil
    }

    public func beginVertexEdit(objectId: String) {
        guard let object = objectsById[objectId], supportsVertexEdit(object) else { return }
        vertexEditObjectId = objectId
        selectedObjectId = objectId
        selectedVertexIndex = nil
        propertySheetObjectId = nil
    }

    /// Exits vertex-edit mode without discarding any already-committed edit
    /// — every vertex/resize/rotate action above already durably committed
    /// on its own, so there is nothing transient left to lose here.
    public func endVertexEdit() {
        vertexEditObjectId = nil
        selectedVertexIndex = nil
    }

    /// Toggles which vertex handle the shape-edit action bar's "Remove
    /// point"/"Split here" apply to — tapping the already-selected handle
    /// deselects it.
    public func selectVertex(objectId: String, index: Int) {
        guard objectId == vertexEditObjectId else { return }
        selectedVertexIndex = (selectedVertexIndex == index) ? nil : index
    }

    /// True when the currently selected vertex can be removed without
    /// violating the minimum-vertex floor or breaking a closed ring's
    /// closure — the action bar's "Remove point" enabled state.
    public var canRemoveSelectedVertex: Bool {
        guard let object = vertexEditObject, let index = selectedVertexIndex else { return false }
        return MapVertexEditCommands.canRemoveVertex(geometry: object.geometry, vertexIndex: index)
    }

    /// True when the currently selected vertex is a valid interior split
    /// point on a `fence`/`path` line — the action bar's "Split here"
    /// enabled state. See `MapEditorViewModelLinework.swift`.
    public var canSplitAtSelectedVertex: Bool {
        guard let object = vertexEditObject, let index = selectedVertexIndex,
            object.category == .fence || object.category == .path
        else { return false }
        return MapVertexEditCommands.canSplit(geometry: object.geometry, atVertexIndex: index)
    }

    /// Commits a dragged vertex handle's new position — `editVertex(.move)`
    /// for an ordinary vertex, or `replaceGeometry` for a closed polygon
    /// ring's shared start/end vertex (see `MapVertexEditCommands`).
    /// `translationScreen` is the gesture's raw screen-space translation,
    /// exactly like `handleObjectDragEnded`'s.
    public func commitVertexMove(objectId: String, vertexIndex: Int, translationScreen: CGSize) async {
        guard let object = objectsById[objectId],
            let originalPosition = MapVertexEditCommands.vertexPosition(of: object.geometry, index: vertexIndex)
        else { return }

        let dxMetres = transform.localDistance(forScreenDistance: Double(translationScreen.width))
        let dyMetres = -transform.localDistance(forScreenDistance: Double(translationScreen.height))
        let newPosition = Position(x: originalPosition.x + dxMetres, y: originalPosition.y + dyMetres)

        guard
            let command = MapVertexEditCommands.moveVertexCommand(
                objectId: objectId,
                expectedRevision: object.revision,
                geometry: object.geometry,
                vertexIndex: vertexIndex,
                to: newPosition
            )
        else { return }

        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Commits an "insert a vertex on this edge" action — always at the
    /// edge's exact midpoint, matching the midpoint handle the canvas
    /// renders it at.
    public func commitVertexInsert(objectId: String, beforeIndex: Int) async {
        guard let object = objectsById[objectId],
            let command = MapVertexEditCommands.insertVertexCommand(
                objectId: objectId,
                expectedRevision: object.revision,
                geometry: object.geometry,
                beforeIndex: beforeIndex
            )
        else { return }

        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Commits the action bar's "Remove point" for the currently selected
    /// vertex.
    public func commitRemoveSelectedVertex() async {
        guard let objectId = vertexEditObjectId, let object = objectsById[objectId],
            let index = selectedVertexIndex,
            let command = MapVertexEditCommands.removeVertexCommand(
                objectId: objectId,
                expectedRevision: object.revision,
                geometry: object.geometry,
                vertexIndex: index
            )
        else { return }

        selectedVertexIndex = nil
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Commits a corner-handle drag: every vertex scaled by `factor` around
    /// the polygon's centroid.
    public func commitResize(objectId: String, factor: Double) async {
        guard let object = objectsById[objectId],
            let geometry = MapShapeTransform.resizedGeometry(object.geometry, factor: factor)
        else { return }

        let command = MapCommandPayload.replaceGeometry(
            ReplaceGeometryPayload(objectId: objectId, expectedRevision: object.revision, geometry: geometry)
        )
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Commits a rotate-handle drag: every vertex rotated by `degrees` around
    /// the polygon's centroid.
    public func commitRotate(objectId: String, degrees: Double) async {
        guard let object = objectsById[objectId],
            let geometry = MapShapeTransform.rotatedGeometry(object.geometry, degrees: degrees)
        else { return }

        let command = MapCommandPayload.replaceGeometry(
            ReplaceGeometryPayload(objectId: objectId, expectedRevision: object.revision, geometry: geometry)
        )
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }
}
