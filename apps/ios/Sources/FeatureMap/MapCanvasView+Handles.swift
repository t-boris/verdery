import CoreDomain
import SwiftUI

/// `MapCanvasView`'s handle and indicator drawing.
///
/// Split out when the canvas crossed this repository's 600-line ceiling. The
/// seam is between *what* the map contains — objects, backgrounds, the grid,
/// the draft being drawn — and the small furniture drawn on top of it for
/// whichever object is being edited.
extension MapCanvasView {
    /// Vertex handles (draggable), edge-midpoint handles (tap to insert), and
    /// — for a `Polygon` — the resize (square) and rotate (circle, offset
    /// above the shape) handles. Consistent with the selection-indicator
    /// style already used elsewhere in this view: filled white with a
    /// coloured stroke, so a handle reads clearly against any category's fill
    /// colour.
    func drawVertexHandles(for geometry: Geometry, context: GraphicsContext, transform: MapViewportTransform) {
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
    static let snapIndicatorColor = Color.green

    /// A lightweight cue for whichever snap `result` reports: a highlighted
    /// ring at the snapped position, plus — for a reference-relative snap
    /// (horizontal/vertical/angle/distance) — a short dashed guide line back
    /// to `referencePoint`, so the alignment reads visually rather than only
    /// being inferable from where the handle jumped to. Reuses
    /// `drawCircleHandle`'s existing look rather than introducing a new
    /// handle style, matching this view's "does not need to be elaborate"
    /// brief.
    func drawSnapIndicator(
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

    func isReferenceRelative(_ kind: MapSnapKind?) -> Bool {
        switch kind {
        case .horizontal, .vertical, .angleIncrement, .roundDistance: true
        case .vertex, .edge, nil: false
        }
    }

    func drawCircleHandle(at center: CGPoint, context: GraphicsContext, color: Color, radius: CGFloat, filled: Bool) {
        let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: rect), with: .color(filled ? color : .white))
        context.stroke(Path(ellipseIn: rect), with: .color(color), lineWidth: 2)
    }

    func drawSquareHandle(at center: CGPoint, context: GraphicsContext, color: Color, halfSide: CGFloat = 6) {
        let rect = CGRect(x: center.x - halfSide, y: center.y - halfSide, width: halfSide * 2, height: halfSide * 2)
        context.fill(Path(rect), with: .color(.white))
        context.stroke(Path(rect), with: .color(color), lineWidth: 2)
    }

    /// Fixed screen-point offset of the rotate handle above the shape's
    /// bounding box — the classic "handle floating above a connector line"
    /// pattern, recomputed from the current geometry every draw rather than
    /// tracked as its own persistent state.
    static let rotateHandleOffsetScreenPoints: CGFloat = 28

    func resizeHandleScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard case .polygon = geometry, let vertices = MapVertexEditCommands.editableVertices(of: geometry),
            let bounds = boundingBox(of: vertices)
        else { return nil }
        return transform.screenPoint(for: Position(x: bounds.max.x, y: bounds.max.y))
    }

    func topCenterScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard case .polygon = geometry, let vertices = MapVertexEditCommands.editableVertices(of: geometry),
            let bounds = boundingBox(of: vertices)
        else { return nil }
        return transform.screenPoint(for: Position(x: (bounds.min.x + bounds.max.x) / 2, y: bounds.max.y))
    }

    func rotateHandleScreenPoint(for geometry: Geometry, transform: MapViewportTransform) -> CGPoint? {
        guard let topCenterScreen = topCenterScreenPoint(for: geometry, transform: transform) else { return nil }
        return CGPoint(x: topCenterScreen.x, y: topCenterScreen.y - Self.rotateHandleOffsetScreenPoints)
    }

    func boundingBox(of positions: [Position]) -> (min: Position, max: Position)? {
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

    func rings(of geometry: Geometry) -> [[Position]] {
        switch geometry {
        case let .polygon(rings): rings
        case let .multiPolygon(polygons): polygons.flatMap { $0 }
        case .point, .lineString, .multiLineString: []
        }
    }

    func lines(of geometry: Geometry) -> [[Position]] {
        switch geometry {
        case let .lineString(line): [line]
        case let .multiLineString(lines): lines
        case .point, .polygon, .multiPolygon: []
        }
    }

    /// One distinct system colour per category — resolved here, and only
    /// here, so `MapObjectColorToken` itself stays free of a SwiftUI import.
    static func color(for token: MapObjectColorToken) -> Color {
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
