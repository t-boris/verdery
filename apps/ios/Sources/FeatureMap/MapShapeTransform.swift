import CoreDomain
import CoreGraphics
import Foundation

/// Pure geometry math for whole-shape resize and rotate — the client-computed
/// new geometry a corner or rotate handle commits via `replaceGeometry`. See
/// `MapCommand.swift`'s doc comment: "resize, rotate, and freehand reshape
/// gestures all commit as ReplaceGeometryPayload — the domain does not care
/// how a client derived a new shape, only what it is."
///
/// Scoped to `Polygon` geometry, matching the work package's "for polygon
/// objects, add corner handles ... and a rotate handle" — `lot`, `structure`,
/// `zone`, `bed`, `waterFeature`, and `utilityExclusion` are every category
/// whose primary geometry can be a `Polygon`. A `Polygon`'s holes, if any,
/// scale and rotate around the same centroid as the exterior ring, so a hole
/// stays proportionally placed inside its shape.
public enum MapShapeTransform {
    /// The arithmetic mean of a ring's vertices, excluding a repeated closing
    /// vertex (which would otherwise double-count one corner). `nil` for an
    /// empty ring.
    public static func centroid(ofRing ring: [Position]) -> Position? {
        let vertices = (ring.count > 1 && ring.first == ring.last) ? Array(ring.dropLast()) : ring
        guard !vertices.isEmpty else { return nil }

        let sum = vertices.reduce(Position(x: 0, y: 0)) { Position(x: $0.x + $1.x, y: $0.y + $1.y) }
        return Position(x: sum.x / Double(vertices.count), y: sum.y / Double(vertices.count))
    }

    /// The centroid of a `Polygon`'s exterior ring, or `nil` for any other
    /// geometry type.
    public static func polygonCentroid(_ geometry: Geometry) -> Position? {
        guard case let .polygon(rings) = geometry, let exterior = rings.first else { return nil }
        return centroid(ofRing: exterior)
    }

    /// `position` scaled by `factor` around `center`.
    public static func scaled(_ position: Position, factor: Double, around center: Position) -> Position {
        Position(
            x: center.x + (position.x - center.x) * factor,
            y: center.y + (position.y - center.y) * factor
        )
    }

    /// `position` rotated by `degrees` (counter-clockwise-positive, matching
    /// garden-local space's east/north axis convention) around `center`.
    public static func rotated(_ position: Position, degrees: Double, around center: Position) -> Position {
        let radians = degrees * .pi / 180
        let dx = position.x - center.x
        let dy = position.y - center.y
        let cosine = cos(radians)
        let sine = sin(radians)

        return Position(
            x: center.x + dx * cosine - dy * sine,
            y: center.y + dx * sine + dy * cosine
        )
    }

    /// The new geometry a corner-handle drag commits: every ring's vertices
    /// scaled by `factor` around the exterior ring's centroid. `nil` for any
    /// geometry that is not a `Polygon`, or a non-finite/non-positive factor.
    public static func resizedGeometry(_ geometry: Geometry, factor: Double) -> Geometry? {
        guard case let .polygon(rings) = geometry, factor.isFinite, factor > 0,
            let center = polygonCentroid(geometry)
        else { return nil }

        return .polygon(rings.map { ring in ring.map { scaled($0, factor: factor, around: center) } })
    }

    /// The new geometry a rotate-handle drag commits: every ring's vertices
    /// rotated by `degrees` around the exterior ring's centroid. `nil` for
    /// any geometry that is not a `Polygon`.
    public static func rotatedGeometry(_ geometry: Geometry, degrees: Double) -> Geometry? {
        guard case let .polygon(rings) = geometry, degrees.isFinite, let center = polygonCentroid(geometry) else {
            return nil
        }

        return .polygon(rings.map { ring in ring.map { rotated($0, degrees: degrees, around: center) } })
    }

    // MARK: - Screen-space gesture math

    /// The scale factor a corner-handle drag represents: the ratio of the
    /// handle's screen distance from the shape's (already screen-projected)
    /// centroid at the end of the gesture to its distance at the start.
    public static func resizeFactor(centroidScreen: CGPoint, startScreen: CGPoint, endScreen: CGPoint) -> Double {
        let startDistance = hypot(Double(startScreen.x - centroidScreen.x), Double(startScreen.y - centroidScreen.y))
        let endDistance = hypot(Double(endScreen.x - centroidScreen.x), Double(endScreen.y - centroidScreen.y))

        guard startDistance > 0 else { return 1 }
        return endDistance / startDistance
    }

    /// The local-space rotation (degrees, counter-clockwise-positive) a
    /// rotate-handle drag represents.
    ///
    /// Screen space mirrors local space's y axis (`MapViewportTransform`'s
    /// doc comment: local north is `+y`, screen south is `+y`), so a
    /// visually clockwise drag on screen is a counter-clockwise angular
    /// change in local coordinates. Negating the raw screen-angle delta is
    /// what keeps `rotatedGeometry`'s local CCW-positive convention feeling
    /// clockwise-positive to the person actually dragging the handle.
    public static func rotationDegrees(centroidScreen: CGPoint, startScreen: CGPoint, endScreen: CGPoint) -> Double {
        let startAngle = atan2(Double(startScreen.y - centroidScreen.y), Double(startScreen.x - centroidScreen.x))
        let endAngle = atan2(Double(endScreen.y - centroidScreen.y), Double(endScreen.x - centroidScreen.x))

        return -(endAngle - startAngle) * 180 / .pi
    }
}
