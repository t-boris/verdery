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
        guard let object = objectsById[objectId], !isObjectLocked(object), supportsVertexEdit(object) else { return }
        vertexEditObjectId = objectId
        selectedObjectId = objectId
        selectedVertexIndex = nil
        propertySheetObjectId = nil
        // A suppression armed in a previous vertex-edit session must never
        // silently carry into this new one — see
        // `isVertexDragSnapSuppressed`'s doc comment.
        isVertexDragSnapSuppressed = false
    }

    /// Exits vertex-edit mode without discarding any already-committed edit
    /// — every vertex/resize/rotate action above already durably committed
    /// on its own, so there is nothing transient left to lose here.
    public func endVertexEdit() {
        vertexEditObjectId = nil
        selectedVertexIndex = nil
        isVertexDragSnapSuppressed = false
    }

    /// Arms/disarms ``isVertexDragSnapSuppressed`` — the vertex-edit action
    /// bar's snap-toggle button.
    public func toggleVertexDragSnapSuppression() {
        isVertexDragSnapSuppressed.toggle()
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
    /// exactly like `handleObjectDragEnded`'s. Runs the raw candidate
    /// position through ``MapSnapping`` first, unless the drag was armed to
    /// skip it (``resolvedVertexDragPosition(_:object:vertexIndex:originalPosition:)``) —
    /// the same computation `MapCanvasView`'s live preview already ran on
    /// every `.onChanged`, so what actually commits always matches what the
    /// user watched the handle snap onto mid-drag.
    public func commitVertexMove(objectId: String, vertexIndex: Int, translationScreen: CGSize) async {
        guard let object = objectsById[objectId], !isObjectLocked(object),
            let originalPosition = MapVertexEditCommands.vertexPosition(of: object.geometry, index: vertexIndex)
        else { return }

        let dxMetres = transform.localDistance(forScreenDistance: Double(translationScreen.width))
        let dyMetres = -transform.localDistance(forScreenDistance: Double(translationScreen.height))
        let rawPosition = Position(x: originalPosition.x + dxMetres, y: originalPosition.y + dyMetres)
        let newPosition = resolvedVertexDragPosition(
            rawPosition,
            object: object,
            vertexIndex: vertexIndex,
            originalPosition: originalPosition
        )

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

    /// `rawPosition` adjusted by ``MapSnapping``, or passed through
    /// unchanged when ``MapEditorViewModel/isVertexDragSnapSuppressed`` is
    /// set or the render snapshot is not currently loaded. Always consumes
    /// ``MapEditorViewModel/isVertexDragSnapSuppressed`` — the suppression
    /// is per-gesture, spent the instant a drag actually attempts to
    /// commit, regardless of whether a command ends up being built from the
    /// result.
    private func resolvedVertexDragPosition(
        _ rawPosition: Position,
        object: GardenMapObject,
        vertexIndex: Int,
        originalPosition: Position
    ) -> Position {
        defer { isVertexDragSnapSuppressed = false }
        guard !isVertexDragSnapSuppressed, case let .loaded(snapshot) = state else { return rawPosition }

        return MapSnapping.snap(
            candidate: rawPosition,
            objects: snapshot.objects,
            excludedObjectId: object.id,
            excludedVertexPosition: originalPosition,
            referencePoint: MapSnapping.referencePosition(in: object.geometry, vertexIndex: vertexIndex),
            toleranceMetres: transform.localDistance(forScreenDistance: Double(GeometryTolerances.snapToleranceScreenPixels))
        ).position
    }

    /// Commits an "insert a vertex on this edge" action — always at the
    /// edge's exact midpoint, matching the midpoint handle the canvas
    /// renders it at.
    public func commitVertexInsert(objectId: String, beforeIndex: Int) async {
        guard let object = objectsById[objectId], !isObjectLocked(object),
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
        guard let objectId = vertexEditObjectId, let object = objectsById[objectId], !isObjectLocked(object),
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
        guard let object = objectsById[objectId], !isObjectLocked(object),
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
        guard let object = objectsById[objectId], !isObjectLocked(object),
            let geometry = MapShapeTransform.rotatedGeometry(object.geometry, degrees: degrees)
        else { return }

        let command = MapCommandPayload.replaceGeometry(
            ReplaceGeometryPayload(objectId: objectId, expectedRevision: object.revision, geometry: geometry)
        )
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }
}
