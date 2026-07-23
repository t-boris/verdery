import CoreDomain
import Foundation

/// Pure snapping math for vertex-handle repositioning in vertex-edit mode.
///
/// architecture/map-rendering-and-editing.md, section "10. Snapping and
/// Constraints" lists six initial snap target kinds and says "constraint
/// metadata must not depend on Konva, Core Graphics, MapLibre, or MapKit
/// types" — this file (and its return types) works only in `CoreDomain`'s
/// plain `Position`/`Geometry` domain, never `CGPoint`. Callers that do own
/// screen coordinates (`MapCanvasView`'s gesture handling,
/// `MapEditorViewModelReshaping.commitVertexMove`) convert to local metres
/// via `MapViewportTransform` first, exactly like `MapHitTesting` and
/// `MapGestureCommands` already require.
///
/// ## Scope: vertex-drag repositioning only
///
/// This app creates every new object by tapping a fixed-size default shape
/// into place, not by freehand point-by-point drawing (see
/// `MapGestureCommands`'s doc comment) — there is no "draft point placement"
/// gesture the way the web editor has one, so there is nothing analogous to
/// build snapping for there. Vertex-handle dragging in vertex-edit mode
/// (`MapVertexEditCommands`, `MapEditorViewModelReshaping`) is the one place
/// this app lets a user place a single point interactively, so it is the
/// only place snapping applies this pass. Whole-object move, resize, and
/// rotate do not get it — resize/rotate act on every vertex of a shape at
/// once by a shared factor/angle, which is a fundamentally different
/// operation from placing one point, and move already has its own
/// tolerance-based hit-testing story; extending snapping to them is future
/// work, not a gap in this one.
///
/// ## Snap target kinds and precedence
///
/// ``snap(candidate:objects:excludedObjectId:excludedVertexPosition:referencePoint:toleranceMetres:)``
/// tries, in order, and applies **at most one**:
///
/// 1. ``snapToVertex(candidate:vertices:toleranceMetres:)`` — an existing
///    vertex of any object (including the one being edited, excluding the
///    vertex currently dragged). This is also how "lot and structure
///    boundaries" from the architecture doc's list are covered: a lot or
///    structure is an ordinary object with vertices, so it needs no special
///    handling beyond being included in `objects` like everything else.
/// 2. ``snapToEdge(candidate:edges:toleranceMetres:)`` — the nearest
///    point on any edge of any object, only once nothing vertex-level
///    qualified.
/// 3. ``snapToAxis(candidate:reference:toleranceMetres:)`` — horizontal or
///    vertical alignment with a reference point, only once nothing
///    geometry-level (vertex or edge) qualified.
/// 4. ``snapToAngleIncrement(candidate:reference:)`` — a configured angle
///    increment from the reference point.
/// 5. ``snapToRoundDistance(candidate:reference:)`` — a round-metre
///    distance from the reference point.
///
/// The architecture doc does not specify an ordering, so this file picks
/// one and documents it: geometry the user can already see (other objects'
/// vertices and edges) outranks the reference-relative constructions
/// (alignment/angle/distance), because snapping onto something concretely
/// on the canvas is a stronger, more legible signal than snapping onto an
/// inferred line/angle/radius. Within each tier the order matches how
/// specific the match is — an exact vertex beats a projected edge point;
/// axis alignment (one coordinate matches exactly) beats an angle (a
/// direction, still leaves distance free) beats a rounded distance (a
/// magnitude, still leaves direction free).
///
/// ## Why the two edges touching the dragged vertex are excluded
///
/// The architecture doc only calls out excluding "the vertex currently
/// being dragged" for vertex snapping. For edge snapping this file goes
/// one step further and also excludes the one or two edges immediately
/// incident to that same vertex (see ``snap(candidate:objects:excludedObjectId:excludedVertexPosition:referencePoint:toleranceMetres:)``'s
/// implementation) — those edges are defined using the vertex's *pre-drag*
/// position, so without this exclusion a vertex dragged roughly along its
/// own original edge would keep snapping back onto a line that is about to
/// stop existing the moment the drag commits, effectively preventing the
/// shape from ever being reshaped in that direction. Excluding only the
/// exact dragged vertex (by position) removes precisely those two edges and
/// nothing else — a non-adjacent edge of the same object, or the whole
/// geometry of any other object, still snaps normally.
///
/// ## Advisory, and can be suppressed for one drag
///
/// Every result here only ever adjusts the position; it never rejects or
/// blocks a move. `MapCanvasView` gives the user a way to skip it for
/// exactly one drag — see `MapEditorViewModel.isVertexDragSnapSuppressed`'s
/// doc comment for the mechanism and why it was chosen over a keyboard
/// modifier (this app has none) or a persisted setting (out of scope this
/// pass, along with a runtime settings surface for the angle-increment and
/// distance-rounding constants below — see each constant's own doc comment).
public enum MapSnapping {
    // MARK: - Named, isolated tolerances and increments

    /// The angle increment reference-relative snapping offers, in degrees.
    /// "Configurable" per the architecture doc is satisfied by this being an
    /// isolated named constant a future change can retarget without
    /// touching any snapping logic — a runtime settings UI to change it at
    /// use time is explicitly out of scope this pass.
    public static let angleIncrementDegrees = 45.0

    /// How close, in degrees, the candidate's angle from the reference point
    /// must be to a multiple of ``angleIncrementDegrees`` to snap.
    public static let angleToleranceDegrees = 4.0

    /// The round-metre grid known-measurement-distance snapping offers,
    /// relative to the reference point.
    public static let distanceRoundingMetres = 0.5

    /// How close, in metres, the candidate's distance from the reference
    /// point must be to a multiple of ``distanceRoundingMetres`` to snap.
    public static let distanceToleranceMetres = 0.1

    /// How close, in metres, the candidate must be to the reference point's
    /// x or y coordinate to snap onto that axis.
    public static let axisToleranceMetres = 0.1

    // MARK: - Entry point

    /// The one function every vertex-drag call site uses: `candidate` (a
    /// raw, not-yet-snapped local position) in, a possibly-adjusted position
    /// plus which snap kind (if any) applied out.
    ///
    /// - Parameters:
    ///   - candidate: The raw local-space position the drag currently
    ///     represents, before any snapping.
    ///   - objects: Every other object in the garden's render snapshot —
    ///     the vertex/edge snap targets. Already excludes deleted objects,
    ///     matching what `MapRenderSnapshot` itself carries.
    ///   - excludedObjectId: The id of the object whose vertex is being
    ///     dragged — its own geometry is still a valid snap target (a
    ///     vertex can snap to another corner of the same shape), just not
    ///     to itself.
    ///   - excludedVertexPosition: The dragged vertex's position *before*
    ///     this drag, used to exclude it (and, for edges, the one or two
    ///     edges touching it) from `excludedObjectId`'s own contributed
    ///     targets. Matched by position, not index, so a closed polygon
    ///     ring's shared start/end vertex is excluded via both of its
    ///     stored copies at once without any extra ring-closure handling
    ///     here.
    ///   - referencePoint: The anchor for horizontal/vertical, angle, and
    ///     round-distance snapping — see
    ///     ``referencePosition(in:vertexIndex:)``. `nil` skips all three.
    ///   - toleranceMetres: Shared by vertex and edge snapping — both
    ///     represent the same "how close on screen" concept, so callers
    ///     convert `GeometryTolerances.snapToleranceScreenPixels` through
    ///     their `MapViewportTransform` once and pass the result here,
    ///     exactly like `MapHitTesting`'s `toleranceMetres` parameter.
    public static func snap(
        candidate: Position,
        objects: [MapRenderObject],
        excludedObjectId: String,
        excludedVertexPosition: Position,
        referencePoint: Position?,
        toleranceMetres: Double
    ) -> MapSnapResult {
        let vertices = collectVertices(objects: objects, excludedObjectId: excludedObjectId, excludedPosition: excludedVertexPosition)
        if let position = snapToVertex(candidate: candidate, vertices: vertices, toleranceMetres: toleranceMetres) {
            return MapSnapResult(position: position, kind: .vertex)
        }

        let edges = collectEdges(objects: objects, excludedObjectId: excludedObjectId, excludedPosition: excludedVertexPosition)
        if let position = snapToEdge(candidate: candidate, edges: edges, toleranceMetres: toleranceMetres) {
            return MapSnapResult(position: position, kind: .edge)
        }

        guard let referencePoint else { return .unsnapped(candidate) }

        if let result = snapToAxis(candidate: candidate, reference: referencePoint, toleranceMetres: axisToleranceMetres) {
            return result
        }
        if let result = snapToAngleIncrement(candidate: candidate, reference: referencePoint) {
            return result
        }
        if let result = snapToRoundDistance(candidate: candidate, reference: referencePoint) {
            return result
        }

        return .unsnapped(candidate)
    }

    /// The dragged vertex's immediate ring-neighbor — the anchor every
    /// reference-relative snap (axis/angle/distance) measures against. One
    /// consistent choice, the previous index in ring order, matching this
    /// work package's brief. `nil` when `geometry`/`vertexIndex` cannot
    /// resolve one (a geometry type vertex editing does not support, or too
    /// few vertices).
    public static func referencePosition(in geometry: Geometry, vertexIndex: Int) -> Position? {
        guard let vertices = MapVertexEditCommands.editableVertices(of: geometry), vertices.count > 1,
            vertexIndex >= 0, vertexIndex < vertices.count
        else { return nil }

        switch geometry.type {
        case .polygon:
            // Ring order, with the ring's duplicate closing vertex folded
            // out of the count. `vertexIndex` here is always inside the
            // renderable range — handles are never placed on that
            // duplicate; see `MapVertexEditCommands.renderableVertexIndices`.
            let ringSize = vertices.count - 1
            guard ringSize > 0 else { return nil }
            return vertices[(vertexIndex - 1 + ringSize) % ringSize]

        case .lineString:
            // An open line does not wrap around: the first vertex has no
            // predecessor, so its only neighbor — the second vertex —
            // stands in as the reference instead.
            return vertices[vertexIndex > 0 ? vertexIndex - 1 : 1]

        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    // MARK: - Individual snap targets

    /// The nearest vertex in `vertices` within `toleranceMetres` of
    /// `candidate`, or `nil` when none qualifies.
    public static func snapToVertex(candidate: Position, vertices: [Position], toleranceMetres: Double) -> Position? {
        var closest: Position?
        var closestDistance = Double.infinity

        for vertex in vertices {
            let distance = GeometryMeasurement.distance(from: candidate, to: vertex)
            guard distance <= toleranceMetres, distance < closestDistance else { continue }
            closestDistance = distance
            closest = vertex
        }

        return closest
    }

    /// The nearest point, among every segment in `edges` projected and
    /// clamped onto that segment, within `toleranceMetres` of `candidate` —
    /// or `nil` when none qualifies.
    public static func snapToEdge(candidate: Position, edges: [(Position, Position)], toleranceMetres: Double) -> Position? {
        var closest: Position?
        var closestDistance = Double.infinity

        for (start, end) in edges {
            let projected = projectedPoint(for: candidate, onSegmentFrom: start, to: end)
            let distance = GeometryMeasurement.distance(from: candidate, to: projected)
            guard distance <= toleranceMetres, distance < closestDistance else { continue }
            closestDistance = distance
            closest = projected
        }

        return closest
    }

    /// Horizontal alignment (candidate's y matches `reference`'s) or
    /// vertical alignment (candidate's x matches `reference`'s) — whichever
    /// qualifies within `toleranceMetres`; when both do, the smaller
    /// deviation wins. `nil` when neither qualifies.
    public static func snapToAxis(candidate: Position, reference: Position, toleranceMetres: Double) -> MapSnapResult? {
        let deltaX = abs(candidate.x - reference.x)
        let deltaY = abs(candidate.y - reference.y)

        let horizontalQualifies = deltaY <= toleranceMetres
        let verticalQualifies = deltaX <= toleranceMetres
        guard horizontalQualifies || verticalQualifies else { return nil }

        if horizontalQualifies, !verticalQualifies || deltaY <= deltaX {
            return MapSnapResult(position: Position(x: candidate.x, y: reference.y), kind: .horizontal)
        }
        return MapSnapResult(position: Position(x: reference.x, y: candidate.y), kind: .vertical)
    }

    /// `candidate` rotated onto the nearest multiple of
    /// ``angleIncrementDegrees`` measured from `reference`, preserving
    /// `candidate`'s distance from `reference` — only when the candidate's
    /// actual angle is within ``angleToleranceDegrees`` of that multiple.
    /// `nil` when out of tolerance or `candidate == reference` (angle
    /// undefined at zero distance).
    public static func snapToAngleIncrement(candidate: Position, reference: Position) -> MapSnapResult? {
        let distance = GeometryMeasurement.distance(from: reference, to: candidate)
        guard distance > 0 else { return nil }

        let angleDegrees = atan2(candidate.y - reference.y, candidate.x - reference.x) * 180 / .pi
        let nearestIncrement = (angleDegrees / angleIncrementDegrees).rounded() * angleIncrementDegrees
        guard abs(angularDifference(angleDegrees, nearestIncrement)) <= angleToleranceDegrees else { return nil }

        let nearestRadians = nearestIncrement * .pi / 180
        let snapped = Position(
            x: reference.x + distance * cos(nearestRadians),
            y: reference.y + distance * sin(nearestRadians)
        )
        return MapSnapResult(position: snapped, kind: .angleIncrement)
    }

    /// `candidate` moved along the reference→candidate direction until its
    /// distance from `reference` is the nearest multiple of
    /// ``distanceRoundingMetres``, preserving `candidate`'s angle from
    /// `reference` — only when the candidate's actual distance is within
    /// ``distanceToleranceMetres`` of that multiple. `nil` when out of
    /// tolerance, the nearest multiple is zero (nothing meaningful to snap
    /// onto), or `candidate == reference`.
    public static func snapToRoundDistance(candidate: Position, reference: Position) -> MapSnapResult? {
        let distance = GeometryMeasurement.distance(from: reference, to: candidate)
        guard distance > 0 else { return nil }

        let nearestRound = (distance / distanceRoundingMetres).rounded() * distanceRoundingMetres
        guard nearestRound > 0, abs(distance - nearestRound) <= distanceToleranceMetres else { return nil }

        let scale = nearestRound / distance
        let snapped = Position(
            x: reference.x + (candidate.x - reference.x) * scale,
            y: reference.y + (candidate.y - reference.y) * scale
        )
        return MapSnapResult(position: snapped, kind: .roundDistance)
    }

    // MARK: - Target collection

    /// Every vertex snapping may target: every position of every object,
    /// except — for `excludedObjectId` only — whichever of its positions
    /// coincide with `excludedPosition` (the dragged vertex itself, and,
    /// for a closed ring's shared start/end vertex, both of its stored
    /// copies at once).
    private static func collectVertices(
        objects: [MapRenderObject],
        excludedObjectId: String,
        excludedPosition: Position
    ) -> [Position] {
        objects.flatMap { object -> [Position] in
            let positions = object.geometry.positions
            guard object.id == excludedObjectId else { return positions }
            return positions.filter { !GeometryMeasurement.positionsCoincide($0, excludedPosition) }
        }
    }

    /// Every edge snapping may target: every segment of every object,
    /// except — for `excludedObjectId` only — whichever segments touch
    /// `excludedPosition` at either endpoint. See this type's doc comment,
    /// "Why the two edges touching the dragged vertex are excluded."
    private static func collectEdges(
        objects: [MapRenderObject],
        excludedObjectId: String,
        excludedPosition: Position
    ) -> [(Position, Position)] {
        objects.flatMap { object -> [(Position, Position)] in
            let segments = edges(of: object.geometry)
            guard object.id == excludedObjectId else { return segments }
            return segments.filter {
                !GeometryMeasurement.positionsCoincide($0.0, excludedPosition)
                    && !GeometryMeasurement.positionsCoincide($0.1, excludedPosition)
            }
        }
    }

    /// Every consecutive-pair segment of `geometry`, across every
    /// line/ring it has. A `Polygon`'s rings are already stored closed
    /// (repeated first/last position), so consecutive pairs alone already
    /// include the closing edge — no separate wraparound segment is added.
    private static func edges(of geometry: Geometry) -> [(Position, Position)] {
        switch geometry {
        case .point:
            return []
        case let .lineString(line):
            return segments(in: line)
        case let .polygon(rings):
            return rings.flatMap { segments(in: $0) }
        case let .multiLineString(lines):
            return lines.flatMap { segments(in: $0) }
        case let .multiPolygon(polygons):
            return polygons.flatMap { $0.flatMap { segments(in: $0) } }
        }
    }

    private static func segments(in line: [Position]) -> [(Position, Position)] {
        guard line.count >= 2 else { return [] }
        return (0..<(line.count - 1)).map { (line[$0], line[$0 + 1]) }
    }

    // MARK: - Geometry helpers

    private static func projectedPoint(for point: Position, onSegmentFrom start: Position, to end: Position) -> Position {
        let deltaX = end.x - start.x
        let deltaY = end.y - start.y
        let lengthSquared = deltaX * deltaX + deltaY * deltaY

        guard lengthSquared > 0 else { return start }

        let t = min(1, max(0, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared))
        return Position(x: start.x + t * deltaX, y: start.y + t * deltaY)
    }

    /// `a - b` normalized into `-180...180`, so a comparison near the
    /// `atan2` wraparound boundary (`±180`) never reports a false ~360°
    /// difference.
    private static func angularDifference(_ a: Double, _ b: Double) -> Double {
        var difference = (a - b).truncatingRemainder(dividingBy: 360)
        if difference > 180 { difference -= 360 }
        if difference < -180 { difference += 360 }
        return difference
    }
}

/// Which kind of snap target ``MapSnapping/snap(candidate:objects:excludedObjectId:excludedVertexPosition:referencePoint:toleranceMetres:)``
/// applied — what drives `MapCanvasView`'s visual indicator.
public enum MapSnapKind: Equatable, Sendable {
    case vertex
    case edge
    case horizontal
    case vertical
    case angleIncrement
    case roundDistance
}

/// A possibly-adjusted local position plus which snap kind, if any, produced
/// it. `kind == nil` means `position == candidate`, unchanged — see
/// ``unsnapped(_:)``.
public struct MapSnapResult: Equatable, Sendable {
    public let position: Position
    public let kind: MapSnapKind?

    public init(position: Position, kind: MapSnapKind?) {
        self.position = position
        self.kind = kind
    }

    /// A result carrying no snap: `position` is exactly `candidate`.
    public static func unsnapped(_ candidate: Position) -> MapSnapResult {
        MapSnapResult(position: candidate, kind: nil)
    }
}
