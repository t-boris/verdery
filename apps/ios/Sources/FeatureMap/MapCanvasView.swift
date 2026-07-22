import CoreDomain
import SwiftUI

/// The `Canvas` layer: draws a `MapRenderSnapshot` and turns raw SwiftUI
/// gestures into calls the view model turns into commands.
///
/// Deliberately thin — the work package asks for gesture and rendering
/// *logic* to live in independently testable pure types
/// (`MapViewportTransform`, `MapHitTesting`, `MapGestureCommands`), with the
/// view itself staying "a thin, mostly-untested layer on top." Every
/// decision this view makes beyond drawing calls straight into one of those;
/// nothing here is unit tested, by design.
struct MapCanvasView: View {
    let snapshot: MapRenderSnapshot
    let transform: MapViewportTransform
    let selectedObjectId: String?

    let onViewportSizeChange: (CGSize) -> Void
    let onTap: (CGPoint) -> Void
    let onPan: (CGSize) -> Void
    let onObjectDragEnded: (String, CGSize) -> Void
    let onZoom: (Double, CGPoint) -> Void

    /// Screen point the current drag gesture began at, `nil` between gestures.
    @State private var dragStartScreen: CGPoint?
    /// Set only when the drag began on the currently selected object — see
    /// `MapGestureCommands.classifyDragEnd`'s doc comment on why an
    /// unselected shape pans instead of moving.
    @State private var dragObjectId: String?
    /// Screen-space translation of the gesture in progress. Used only to
    /// preview a pan or an object move; the committed transform or command
    /// is built once, at `.onEnded`, never from this value directly.
    @State private var liveDragTranslation: CGSize = .zero
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
                    dragObjectId = selectedObjectId(atScreen: value.startLocation)
                }
                liveDragTranslation = value.translation
            }
            .onEnded { value in
                let start = dragStartScreen
                dragStartScreen = nil
                dragObjectId = nil
                liveDragTranslation = .zero

                guard let start else { return }

                switch MapGestureCommands.classifyDragEnd(
                    startScreen: start,
                    endScreen: value.location,
                    selectedObjectIdAtStart: dragObjectId
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

    // MARK: - Drawing

    private func draw(context: GraphicsContext, size: CGSize) {
        var effectiveTransform = transform

        if liveZoomFactor != 1 {
            effectiveTransform = effectiveTransform.zoomed(by: liveZoomFactor, around: zoomAnchor)
        } else if dragStartScreen != nil, dragObjectId == nil {
            effectiveTransform = effectiveTransform.panned(byScreenTranslation: liveDragTranslation)
        }

        for object in snapshot.objects {
            let extraOffset = (object.id == dragObjectId) ? liveDragTranslation : .zero
            draw(object, context: context, transform: effectiveTransform, extraOffset: extraOffset)
        }
    }

    private func draw(
        _ object: MapRenderObject,
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

        switch MapObjectRenderKind(geometryType: object.geometry.type) {
        case .area:
            for ring in rings(of: object.geometry) {
                var path = Path()
                path.addLines(ring.map(point))
                path.closeSubpath()
                context.fill(path, with: .color(color.opacity(0.22)))
                context.stroke(path, with: .color(color), lineWidth: isSelected ? 3 : 1.5)
            }

        case .line:
            for line in lines(of: object.geometry) {
                var path = Path()
                path.addLines(line.map(point))
                context.stroke(
                    path,
                    with: .color(color),
                    style: StrokeStyle(lineWidth: isSelected ? 4 : 2, lineCap: .round)
                )
            }

        case .marker:
            for position in object.geometry.positions {
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
