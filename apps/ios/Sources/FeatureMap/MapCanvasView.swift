import CoreDomain
import SwiftUI

/// The `Canvas` layer: draws a `MapRenderSnapshot` and turns raw SwiftUI
/// gestures into calls the view model turns into commands.
///
/// Deliberately thin — the work package asks for gesture and rendering
/// *logic* to live in independently testable pure types
/// (`MapViewportTransform`, `MapHitTesting`, `MapGestureCommands`,
/// `MapVertexEditCommands`, `MapShapeTransform`, `MapSnapping`), with the
/// view itself staying "a thin, mostly-untested layer on top." Every
/// decision this view makes beyond drawing calls straight into one of
/// those; nothing here is unit tested, by design.
///
/// Vertex-edit mode (`vertexEditObjectId` non-nil) adds one more class of
/// gesture target — a vertex handle, an edge-midpoint handle, or (for a
/// `Polygon`) the resize/rotate handles — to the single `DragGesture` this
/// view already used for object drag and canvas pan. A handle hit at the
/// gesture's start claims the whole gesture, exactly like an object hit
/// already did for `dragObjectId`; when nothing in vertex-edit mode is hit,
/// the gesture falls through to the ordinary object-drag/pan/tap handling
/// unchanged, so panning to reach an off-screen handle still works. A vertex
/// handle's drag additionally runs through `MapSnapping` on every
/// `.onChanged` (unless `isVertexDragSnapSuppressed`), previewed here and
/// committed identically by `MapEditorViewModelReshaping.commitVertexMove`.
struct MapCanvasView: View {
    let snapshot: MapRenderSnapshot
    let transform: MapViewportTransform
    let selectedObjectId: String?
    let vertexEditObjectId: String?
    let selectedVertexIndex: Int?
    /// True while the vertex-edit action bar's snap toggle has armed
    /// suppression for the next vertex-handle drag — see
    /// `MapEditorViewModel.isVertexDragSnapSuppressed`'s doc comment.
    let isVertexDragSnapSuppressed: Bool

    let onViewportSizeChange: (CGSize) -> Void
    let onTap: (CGPoint) -> Void
    let onPan: (CGSize) -> Void
    let onObjectDragEnded: (String, CGSize) -> Void
    let onZoom: (Double, CGPoint) -> Void
    let onVertexTap: (String, Int) -> Void
    let onVertexDragEnded: (String, Int, CGSize) -> Void
    let onMidpointTap: (String, Int) -> Void
    let onResizeEnded: (String, Double) -> Void
    let onRotateEnded: (String, Double) -> Void

    /// One vertex-edit-mode gesture target, resolved once at gesture start —
    /// the same "classify once, at the boundary" discipline
    /// `MapGestureCommands.classifyDragEnd` documents for ordinary drags.
    private enum ReshapeHandle: Equatable {
        case vertex(objectId: String, index: Int)
        case midpoint(objectId: String, beforeIndex: Int)
        case resize(objectId: String)
        case rotate(objectId: String)

        var objectId: String {
            switch self {
            case let .vertex(objectId, _): objectId
            case let .midpoint(objectId, _): objectId
            case let .resize(objectId): objectId
            case let .rotate(objectId): objectId
            }
        }
    }

    /// Screen point the current drag gesture began at, `nil` between gestures.
    @State private var dragStartScreen: CGPoint?
    /// Set only when the drag began on the currently selected object — see
    /// `MapGestureCommands.classifyDragEnd`'s doc comment on why an
    /// unselected shape pans instead of moving.
    @State private var dragObjectId: String?
    /// Set only when the drag began on a vertex-edit-mode handle; mutually
    /// exclusive with `dragObjectId`.
    @State private var activeHandle: ReshapeHandle?
    /// Screen-space translation of the gesture in progress. Used only to
    /// preview a pan, object move, or vertex drag; the committed transform or
    /// command is built once, at `.onEnded`, never from this value directly.
    @State private var liveDragTranslation: CGSize = .zero
    /// The in-progress vertex move / resize / rotate preview for
    /// `activeHandle`'s object, recomputed on every `.onChanged` via the same
    /// pure functions the eventual commit uses — never drawn from anything
    /// but those functions, so the preview can never show something the
    /// commit would not actually produce.
    @State private var livePreviewGeometry: Geometry?
    /// The snap that produced `livePreviewGeometry`'s moved vertex, kept
    /// only while it actually applied (`kind != nil`) — what
    /// `drawSnapIndicator` draws. `nil` between gestures, while dragging
    /// anything other than a vertex handle, and whenever the current
    /// candidate is not close enough to any snap target.
    @State private var activeSnapResult: MapSnapResult?
    @State private var liveZoomFactor: Double = 1
    @State private var zoomAnchor: CGPoint = .zero

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                draw(context: context, size: size)
            }
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .simultaneousGesture(magnificationGesture(in: proxy.size))
            .onAppear { onViewportSizeChange(proxy.size) }
            .onChange(of: proxy.size) { _, newSize in onViewportSizeChange(newSize) }
        }
    }

    // MARK: - Gestures

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragStartScreen == nil {
                    dragStartScreen = value.startLocation
                    activeHandle = vertexEditObjectId != nil ? handleTarget(atScreen: value.startLocation) : nil
                    activeSnapResult = nil
                    if activeHandle == nil {
                        dragObjectId = selectedObjectId(atScreen: value.startLocation)
                    }
                }
                liveDragTranslation = value.translation
                if let activeHandle {
                    updateLivePreview(for: activeHandle, translation: value.translation, currentScreen: value.location)
                }
            }
            .onEnded { value in
                let start = dragStartScreen
                let objectId = dragObjectId
                let handle = activeHandle
                dragStartScreen = nil
                dragObjectId = nil
                activeHandle = nil
                liveDragTranslation = .zero
                livePreviewGeometry = nil
                activeSnapResult = nil

                guard let start else { return }

                if let handle {
                    commitReshape(handle, start: start, end: value.location)
                    return
                }

                switch MapGestureCommands.classifyDragEnd(
                    startScreen: start,
                    endScreen: value.location,
                    selectedObjectIdAtStart: objectId
                ) {
                case let .tap(point):
                    onTap(point)
                case let .moveObject(objectId, translation):
                    onObjectDragEnded(objectId, translation)
                case let .pan(translation):
                    onPan(translation)
                }
            }
    }

    private func magnificationGesture(in size: CGSize) -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                liveZoomFactor = value
                zoomAnchor = CGPoint(x: size.width / 2, y: size.height / 2)
            }
            .onEnded { value in
                onZoom(value, zoomAnchor)
                liveZoomFactor = 1
            }
    }

    /// The id of the currently selected object if, and only if, `point` also
    /// hits it — a drag starting anywhere else pans instead of moving it.
    private func selectedObjectId(atScreen point: CGPoint) -> String? {
        guard let selectedObjectId else { return nil }

        let local = transform.localPosition(for: point)
        let toleranceMetres = transform.localDistance(
            forScreenDistance: MapGestureCommands.tapThresholdScreenPoints
        )

        guard let object = snapshot.objects.first(where: { $0.id == selectedObjectId }) else { return nil }
        return MapHitTesting.hits(object.geometry, at: local, toleranceMetres: toleranceMetres)
            ? selectedObjectId
            : nil
    }

    /// The vertex-edit-mode handle at `point`, or `nil` when nothing in
    /// vertex-edit mode is there — priority is vertex handles, then edge
    /// midpoints, then the whole-shape resize/rotate handles, matching the
    /// order they are drawn in (a vertex handle always wins a tie against a
    /// resize/rotate handle placed nearby).
    private func handleTarget(atScreen point: CGPoint) -> ReshapeHandle? {
        guard let objectId = vertexEditObjectId,
            let object = snapshot.objects.first(where: { $0.id == objectId })
        else { return nil }

        let tolerance = MapGestureCommands.tapThresholdScreenPoints
        let geometry = object.geometry

        if let indices = MapVertexEditCommands.renderableVertexIndices(of: geometry) {
            for index in indices {
                guard let position = MapVertexEditCommands.vertexPosition(of: geometry, index: index) else { continue }
                if screenDistance(transform.screenPoint(for: position), point) <= tolerance {
                    return .vertex(objectId: objectId, index: index)
                }
            }
        }

        if let beforeIndices = MapVertexEditCommands.midpointBeforeIndices(of: geometry) {
            for beforeIndex in beforeIndices {
                guard let position = MapVertexEditCommands.midpoint(of: geometry, beforeIndex: beforeIndex) else {
                    continue
                }
                if screenDistance(transform.screenPoint(for: position), point) <= tolerance {
                    return .midpoint(objectId: objectId, beforeIndex: beforeIndex)
                }
            }
        }

        if let resizePoint = resizeHandleScreenPoint(for: geometry, transform: transform),
            screenDistance(resizePoint, point) <= tolerance {
            return .resize(objectId: objectId)
        }

        if let rotatePoint = rotateHandleScreenPoint(for: geometry, transform: transform),
            screenDistance(rotatePoint, point) <= tolerance {
            return .rotate(objectId: objectId)
        }

        return nil
    }

    private func screenDistance(_ a: CGPoint, _ b: CGPoint) -> Double {
        let dx = Double(a.x - b.x)
        let dy = Double(a.y - b.y)
        return (dx * dx + dy * dy).squareRoot()
    }

    private func updateLivePreview(for handle: ReshapeHandle, translation: CGSize, currentScreen: CGPoint) {
        guard let object = snapshot.objects.first(where: { $0.id == handle.objectId }) else { return }

        switch handle {
        case let .vertex(objectId, index):
            guard let original = MapVertexEditCommands.vertexPosition(of: object.geometry, index: index) else { return }
            let dxMetres = transform.localDistance(forScreenDistance: Double(translation.width))
            let dyMetres = -transform.localDistance(forScreenDistance: Double(translation.height))
            let rawPosition = Position(x: original.x + dxMetres, y: original.y + dyMetres)

            let result = isVertexDragSnapSuppressed
                ? MapSnapResult.unsnapped(rawPosition)
                : MapSnapping.snap(
                    candidate: rawPosition,
                    objects: snapshot.objects,
                    excludedObjectId: objectId,
                    excludedVertexPosition: original,
                    referencePoint: MapSnapping.referencePosition(in: object.geometry, vertexIndex: index),
                    toleranceMetres: transform.localDistance(forScreenDistance: Double(GeometryTolerances.snapToleranceScreenPixels))
                )

            activeSnapResult = result.kind != nil ? result : nil
            livePreviewGeometry = MapVertexEditCommands.movingVertex(in: object.geometry, vertexIndex: index, to: result.position)

        case .midpoint:
            break // Insert commits immediately on tap; there is nothing to preview mid-drag.

        case .resize:
            guard let centroidLocal = MapShapeTransform.polygonCentroid(object.geometry) else { return }
            let centroidScreen = transform.screenPoint(for: centroidLocal)
            let startScreen = CGPoint(x: currentScreen.x - translation.width, y: currentScreen.y - translation.height)
            let factor = MapShapeTransform.resizeFactor(centroidScreen: centroidScreen, startScreen: startScreen, endScreen: currentScreen)
            livePreviewGeometry = MapShapeTransform.resizedGeometry(object.geometry, factor: factor)

        case .rotate:
            guard let centroidLocal = MapShapeTransform.polygonCentroid(object.geometry) else { return }
            let centroidScreen = transform.screenPoint(for: centroidLocal)
            let startScreen = CGPoint(x: currentScreen.x - translation.width, y: currentScreen.y - translation.height)
            let degrees = MapShapeTransform.rotationDegrees(centroidScreen: centroidScreen, startScreen: startScreen, endScreen: currentScreen)
            livePreviewGeometry = MapShapeTransform.rotatedGeometry(object.geometry, degrees: degrees)
        }
    }

    private func commitReshape(_ handle: ReshapeHandle, start: CGPoint, end: CGPoint) {
        let translation = CGSize(width: end.x - start.x, height: end.y - start.y)
        let magnitude = (translation.width * translation.width + translation.height * translation.height).squareRoot()
        let isTap = magnitude < MapGestureCommands.tapThresholdScreenPoints

        switch handle {
        case let .vertex(objectId, index):
            if isTap {
                onVertexTap(objectId, index)
            } else {
                onVertexDragEnded(objectId, index, translation)
            }

        case let .midpoint(objectId, beforeIndex):
            // A drag on a midpoint handle that never becomes a real vertex is
            // a no-op — there is nothing there yet to move.
            if isTap {
                onMidpointTap(objectId, beforeIndex)
            }

        case let .resize(objectId):
            guard !isTap, let object = snapshot.objects.first(where: { $0.id == objectId }),
                let centroidLocal = MapShapeTransform.polygonCentroid(object.geometry)
            else { return }
            let centroidScreen = transform.screenPoint(for: centroidLocal)
            let factor = MapShapeTransform.resizeFactor(centroidScreen: centroidScreen, startScreen: start, endScreen: end)
            onResizeEnded(objectId, factor)

        case let .rotate(objectId):
            guard !isTap, let object = snapshot.objects.first(where: { $0.id == objectId }),
                let centroidLocal = MapShapeTransform.polygonCentroid(object.geometry)
            else { return }
            let centroidScreen = transform.screenPoint(for: centroidLocal)
            let degrees = MapShapeTransform.rotationDegrees(centroidScreen: centroidScreen, startScreen: start, endScreen: end)
            onRotateEnded(objectId, degrees)
        }
    }

    // MARK: - Drawing

    private func draw(context: GraphicsContext, size: CGSize) {
        var effectiveTransform = transform

        if liveZoomFactor != 1 {
            effectiveTransform = effectiveTransform.zoomed(by: liveZoomFactor, around: zoomAnchor)
        } else if dragStartScreen != nil, dragObjectId == nil, activeHandle == nil {
            effectiveTransform = effectiveTransform.panned(byScreenTranslation: liveDragTranslation)
        }

        for object in snapshot.objects {
            let extraOffset = (object.id == dragObjectId) ? liveDragTranslation : .zero
            let renderGeometry = (activeHandle?.objectId == object.id) ? (livePreviewGeometry ?? object.geometry) : object.geometry
            draw(object, geometry: renderGeometry, context: context, transform: effectiveTransform, extraOffset: extraOffset)
        }

        if let vertexEditObjectId, let object = snapshot.objects.first(where: { $0.id == vertexEditObjectId }) {
            let geometry = (activeHandle != nil) ? (livePreviewGeometry ?? object.geometry) : object.geometry
            drawVertexHandles(for: geometry, context: context, transform: effectiveTransform)

            if let activeSnapResult, case let .vertex(_, index) = activeHandle {
                drawSnapIndicator(
                    activeSnapResult,
                    referencePoint: MapSnapping.referencePosition(in: object.geometry, vertexIndex: index),
                    context: context,
                    transform: effectiveTransform
                )
            }
        }
    }

    private func draw(
        _ object: MapRenderObject,
        geometry: Geometry,
        context: GraphicsContext,
        transform: MapViewportTransform,
        extraOffset: CGSize
    ) {
        let isSelected = object.id == selectedObjectId
        let color = Self.color(for: MapObjectColorToken(category: object.category))

        func point(_ position: Position) -> CGPoint {
            let screen = transform.screenPoint(for: position)
            return CGPoint(x: screen.x + extraOffset.width, y: screen.y + extraOffset.height)
        }

        switch MapObjectRenderKind(geometryType: geometry.type) {
        case .area:
            for ring in rings(of: geometry) {
                var path = Path()
                path.addLines(ring.map(point))
                path.closeSubpath()
                context.fill(path, with: .color(color.opacity(0.22)))
                context.stroke(path, with: .color(color), lineWidth: isSelected ? 3 : 1.5)
            }

        case .line:
            for line in lines(of: geometry) {
                var path = Path()
                path.addLines(line.map(point))
                context.stroke(
                    path,
                    with: .color(color),
                    style: StrokeStyle(lineWidth: isSelected ? 4 : 2, lineCap: .round)
                )
            }

        case .marker:
            for position in geometry.positions {
                let center = point(position)
                let radius: CGFloat = isSelected ? 9 : 7
                let markerRect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)

                context.fill(Path(ellipseIn: markerRect), with: .color(color))

                if isSelected {
                    context.stroke(
                        Path(ellipseIn: markerRect.insetBy(dx: -3, dy: -3)),
                        with: .color(color),
                        lineWidth: 2
                    )
                }
            }
        }
    }

    /// Vertex handles (draggable), edge-midpoint handles (tap to insert), and
    /// — for a `Polygon` — the resize (square) and rotate (circle, offset
    /// above the shape) handles. Consistent with the selection-indicator
    /// style already used elsewhere in this view: filled white with a
    /// coloured stroke, so a handle reads clearly against any category's fill
    /// colour.
    private func drawVertexHandles(for geometry: Geometry, context: GraphicsContext, transform: MapViewportTransform) {
        let strokeColor = Color.accentColor

        if let indices = MapVertexEditCommands.renderableVertexIndices(of: geometry) {
            for index in indices {
                guard let position = MapVertexEditCommands.vertexPosition(of: geometry, index: index) else { continue }
                let isSelected = index == selectedVertexIndex
                drawCircleHandle(
                    at: transform.screenPoint(for: position),
                    context: context,
                    color: strokeColor,
                    radius: isSelected ? 8 : 6,
                    filled: isSelected
                )
            }
        }

        if let beforeIndices = MapVertexEditCommands.midpointBeforeIndices(of: geometry) {
            for beforeIndex in beforeIndices {
                guard let position = MapVertexEditCommands.midpoint(of: geometry, beforeIndex: beforeIndex) else {
                    continue
                }
                let center = transform.screenPoint(for: position)
                let radius: CGFloat = 4
                let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                context.fill(Path(ellipseIn: rect), with: .color(strokeColor.opacity(0.55)))
            }
        }

        if let resizePoint = resizeHandleScreenPoint(for: geometry, transform: transform) {
            drawSquareHandle(at: resizePoint, context: context, color: strokeColor)
        }

        if let rotatePoint = rotateHandleScreenPoint(for: geometry, transform: transform),
            let topCenterScreen = topCenterScreenPoint(for: geometry, transform: transform) {
            var connector = Path()
            connector.move(to: topCenterScreen)
            connector.addLine(to: rotatePoint)
            context.stroke(connector, with: .color(strokeColor.opacity(0.6)), lineWidth: 1)
            drawCircleHandle(at: rotatePoint, context: context, color: .orange, radius: 7, filled: false)
        }
    }

    /// The colour every ``MapSnapKind`` renders as — one consistent colour
    /// for "something snapped," distinguished from the ordinary handle's
    /// accent colour, is enough of a cue without needing a colour per kind.
    private static let snapIndicatorColor = Color.green

    /// A lightweight cue for whichever snap `result` reports: a highlighted
    /// ring at the snapped position, plus — for a reference-relative snap
    /// (horizontal/vertical/angle/distance) — a short dashed guide line back
    /// to `referencePoint`, so the alignment reads visually rather than only
    /// being inferable from where the handle jumped to. Reuses
    /// `drawCircleHandle`'s existing look rather than introducing a new
    /// handle style, matching this view's "does not need to be elaborate"
    /// brief.
    private func drawSnapIndicator(
        _ result: MapSnapResult,
        referencePoint: Position?,
        context: GraphicsContext,
        transform: MapViewportTransform
    ) {
        let targetScreen = transform.screenPoint(for: result.position)

        if let referencePoint, isReferenceRelative(result.kind) {
            var guideLine = Path()
            guideLine.move(to: transform.screenPoint(for: referencePoint))
            guideLine.addLine(to: targetScreen)
            context.stroke(
                guideLine,
                with: .color(Self.snapIndicatorColor.opacity(0.7)),
                style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])
            )
        }

        drawCircleHandle(at: targetScreen, context: context, color: Self.snapIndicatorColor, radius: 9, filled: false)
    }

    private func isReferenceRelative(_ kind: MapSnapKind?) -> Bool {
        switch kind {
        case .horizontal, .vertical, .angleIncrement, .roundDistance: true
        case .vertex, .edge, nil: false
        }
    }

    private func drawCircleHandle(at center: CGPoint, context: GraphicsContext, color: Color, radius: CGFloat, filled: Bool) {
        let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: rect), with: .color(filled ? color : .white))
        context.stroke(Path(ellipseIn: rect), with: .color(color), lineWidth: 2)
    }

    private func drawSquareHandle(at center: CGPoint, context: GraphicsContext, color: Color, halfSide: CGFloat = 6) {
        let rect = CGRect(x: center.x - halfSide, y: center.y - halfSide, width: halfSide * 2, height: halfSide * 2)
        context.fill(Path(rect), with: .color(.white))
        context.stroke(Path(rect), with: .color(color), lineWidth: 2)
    }

    /// Fixed screen-point offset of the rotate handle above the shape's
    /// bounding box — the classic "handle floating above a connector line"
    /// pattern, recomputed from the current geometry every draw rather than
    /// tracked as its own persistent state.
    private static let rotateHandleOffsetScreenPoints: CGFloat = 28

    private func resizeHandleScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard case .polygon = geometry, let vertices = MapVertexEditCommands.editableVertices(of: geometry),
            let bounds = boundingBox(of: vertices)
        else { return nil }
        return transform.screenPoint(for: Position(x: bounds.max.x, y: bounds.max.y))
    }

    private func topCenterScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard case .polygon = geometry, let vertices = MapVertexEditCommands.editableVertices(of: geometry),
            let bounds = boundingBox(of: vertices)
        else { return nil }
        return transform.screenPoint(for: Position(x: (bounds.min.x + bounds.max.x) / 2, y: bounds.max.y))
    }

    private func rotateHandleScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard let topCenterScreen = topCenterScreenPoint(for: geometry, transform: transform) else { return nil }
        return CGPoint(x: topCenterScreen.x, y: topCenterScreen.y - Self.rotateHandleOffsetScreenPoints)
    }

    private func boundingBox(of positions: [Position]) -> (min: Position, max: Position)? {
        guard let first = positions.first else { return nil }

        var minX = first.x
        var maxX = first.x
        var minY = first.y
        var maxY = first.y

        for position in positions.dropFirst() {
            minX = min(minX, position.x)
            maxX = max(maxX, position.x)
            minY = min(minY, position.y)
            maxY = max(maxY, position.y)
        }

        return (Position(x: minX, y: minY), Position(x: maxX, y: maxY))
    }

    private func rings(of geometry: Geometry) -> [[Position]] {
        switch geometry {
        case let .polygon(rings): rings
        case let .multiPolygon(polygons): polygons.flatMap { $0 }
        case .point, .lineString, .multiLineString: []
        }
    }

    private func lines(of geometry: Geometry) -> [[Position]] {
        switch geometry {
        case let .lineString(line): [line]
        case let .multiLineString(lines): lines
        case .point, .polygon, .multiPolygon: []
        }
    }

    /// One distinct system colour per category — resolved here, and only
    /// here, so `MapObjectColorToken` itself stays free of a SwiftUI import.
    private static func color(for token: MapObjectColorToken) -> Color {
        switch token {
        case .lot: .brown
        case .structure: .gray
        case .fence: .orange
        case .gate: .yellow
        case .path: .indigo
        case .zone: .mint
        case .bed: .green
        case .waterFeature: .blue
        case .utilityExclusion: .red
        case .tree: .teal
        case .plant: .pink
        case .annotation: .purple
        case .importedBackground: .cyan
        }
    }
}
