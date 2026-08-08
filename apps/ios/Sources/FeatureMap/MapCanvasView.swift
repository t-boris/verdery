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
    /// Imported-background underlays, drawn beneath every object in
    /// document order — see `MapCanvasBackgroundRendering.swift`.
    let backgroundLayers: [MapBackgroundRenderLayer]
    let transform: MapViewportTransform
    let selectedObjectId: String?
    let vertexEditObjectId: String?
    let selectedVertexIndex: Int?
    /// True while the vertex-edit action bar's snap toggle has armed
    /// suppression for the next vertex-handle drag — see
    /// `MapEditorViewModel.isVertexDragSnapSuppressed`'s doc comment.
    let isVertexDragSnapSuppressed: Bool

    /// Points placed so far in a shape being drawn, for the live preview.
    /// Empty when nothing is being drawn.
    var draftScreenPoints: [CGPoint] = []
    /// True while a shape is being drawn, which changes what one finger means:
    /// a tap places a vertex and a drag traces an edge, rather than selecting
    /// and panning.
    var isDrafting: Bool = false

    let onViewportSizeChange: (CGSize) -> Void
    let onTap: (CGPoint) -> Void
    /// A freehand trace, in screen points, sampled during the drag.
    var onTrace: ([CGPoint]) -> Void = { _ in }
    let onPan: (CGSize) -> Void
    let onObjectDragEnded: (String, CGSize) -> Void
    let onZoom: (Double, CGPoint) -> Void
    /// A finished two-finger turn: degrees clockwise, and the screen point to
    /// hold still while applying them.
    var onRotate: (Double, CGPoint) -> Void = { _, _ in }
    let onVertexTap: (String, Int) -> Void
    let onVertexDragEnded: (String, Int, CGSize) -> Void
    let onMidpointTap: (String, Int) -> Void
    let onResizeEnded: (String, Double) -> Void
    let onRotateEnded: (String, Double) -> Void

    /// One vertex-edit-mode gesture target, resolved once at gesture start —
    /// the same "classify once, at the boundary" discipline
    /// `MapGestureCommands.classifyDragEnd` documents for ordinary drags.
    enum ReshapeHandle: Equatable {
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
    /// The turn of the rotate gesture in progress, previewed the same way
    /// `liveZoomFactor` previews a pinch and committed once at `.onEnded`.
    @State private var liveRotationDegrees: Double = 0
    @State private var rotationAnchor: CGPoint = .zero
    @State private var tracedScreenPoints: [CGPoint] = []

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                draw(context: context, size: size)
            }
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .simultaneousGesture(magnificationGesture(in: proxy.size))
            .simultaneousGesture(rotationGesture(in: proxy.size))
            .onAppear { onViewportSizeChange(proxy.size) }
            .onChange(of: proxy.size) { _, newSize in onViewportSizeChange(newSize) }
        }
    }

    // MARK: - Gestures

    var dragGesture: some Gesture {
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
                if isDrafting {
                    // Sampled rather than taken whole at the end: a finger
                    // leaves a path, and only its shape survives
                    // simplification anyway.
                    tracedScreenPoints.append(value.location)
                    return
                }
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

                // One finger draws while a shape is being drawn. A drag long
                // enough to have left samples is a traced edge; anything
                // shorter was a tap, and places one vertex.
                if isDrafting {
                    let traced = tracedScreenPoints
                    tracedScreenPoints = []
                    if traced.count > 1 {
                        onTrace(traced)
                    } else {
                        onTap(value.location)
                    }
                    return
                }

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

    /// Pinch, anchored where the fingers are.
    ///
    /// `MapViewportTransform.zoomed(by:around:)` has always taken an anchor and
    /// kept the garden position under it fixed. This gesture never gave it one:
    /// it passed the middle of the canvas, so the ground under the fingers slid
    /// away while something else grew — which reads, correctly, as the map
    /// fighting the hand.
    ///
    /// The cause was the gesture type. `MagnificationGesture` reports only a
    /// magnitude, so the centre was the only anchor available to it;
    /// `MagnifyGesture` (iOS 17) adds `startAnchor`, in this view's own
    /// coordinate space as a unit point. Multiplying it back out by `size` is
    /// the whole conversion.
    func magnificationGesture(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                liveZoomFactor = value.magnification
                zoomAnchor = CGPoint(
                    x: value.startAnchor.x * size.width,
                    y: value.startAnchor.y * size.height
                )
            }
            .onEnded { value in
                onZoom(value.magnification, zoomAnchor)
                liveZoomFactor = 1
            }
    }

    /// Two fingers turning the view, about the point they are holding.
    ///
    /// Simultaneous with the pinch on purpose: turning and zooming a map are
    /// one motion of the hand, and forcing a choice between them is what makes
    /// a map feel like it is resisting. Both are previewed continuously and
    /// committed once, so a turn is one entry in the transform's history
    /// rather than a hundred.
    ///
    /// This changes the camera and nothing else. Rotating an OBJECT is a
    /// separate, deliberate act behind a handle in vertex-edit mode — a
    /// two-finger twist over the canvas must never reshape the garden.
    func rotationGesture(in size: CGSize) -> some Gesture {
        RotateGesture()
            .onChanged { value in
                liveRotationDegrees = value.rotation.degrees
                rotationAnchor = CGPoint(
                    x: value.startAnchor.x * size.width,
                    y: value.startAnchor.y * size.height
                )
            }
            .onEnded { value in
                onRotate(value.rotation.degrees, rotationAnchor)
                liveRotationDegrees = 0
            }
    }

    /// The id of the currently selected object if, and only if, `point` also
    /// hits it — a drag starting anywhere else pans instead of moving it.
    func selectedObjectId(atScreen point: CGPoint) -> String? {
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
    func handleTarget(atScreen point: CGPoint) -> ReshapeHandle? {
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

    func screenDistance(_ a: CGPoint, _ b: CGPoint) -> Double {
        let dx = Double(a.x - b.x)
        let dy = Double(a.y - b.y)
        return (dx * dx + dy * dy).squareRoot()
    }

    func updateLivePreview(for handle: ReshapeHandle, translation: CGSize, currentScreen: CGPoint) {
        guard let object = snapshot.objects.first(where: { $0.id == handle.objectId }) else { return }

        switch handle {
        case let .vertex(objectId, index):
            guard let original = MapVertexEditCommands.vertexPosition(of: object.geometry, index: index) else { return }
            let moved = transform.localOffset(forScreenTranslation: translation)
            let rawPosition = Position(x: original.x + moved.dx, y: original.y + moved.dy)

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

    func commitReshape(_ handle: ReshapeHandle, start: CGPoint, end: CGPoint) {
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

    func draw(context: GraphicsContext, size: CGSize) {
        var effectiveTransform = transform

        if liveRotationDegrees != 0 {
            effectiveTransform = effectiveTransform.rotated(by: liveRotationDegrees, around: rotationAnchor)
        }
        if liveZoomFactor != 1 {
            effectiveTransform = effectiveTransform.zoomed(by: liveZoomFactor, around: zoomAnchor)
        } else if dragStartScreen != nil, dragObjectId == nil, activeHandle == nil {
            effectiveTransform = effectiveTransform.panned(byScreenTranslation: liveDragTranslation)
        }

        drawBackgroundImages(
            context: context, transform: effectiveTransform,
            dragObjectId: dragObjectId, dragTranslation: liveDragTranslation)

        for object in snapshot.objects {
            let extraOffset = (object.id == dragObjectId) ? liveDragTranslation : .zero
            let renderGeometry = (activeHandle?.objectId == object.id) ? (livePreviewGeometry ?? object.geometry) : object.geometry
            draw(object, geometry: renderGeometry, context: context, transform: effectiveTransform, extraOffset: extraOffset)
        }

        drawBackgroundBadges(
            context: context, transform: effectiveTransform,
            dragObjectId: dragObjectId, dragTranslation: liveDragTranslation)

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

    func draw(
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

}
