import Foundation

/// Planar measurement primitives shared by validation and the map editor.
///
/// The local space is Cartesian and in metres, so plane geometry applies
/// directly and no projection is involved.
///
/// Source: ADR-0010, "Coordinate space registration".
public enum GeometryMeasurement {
    /// Distance between two positions in metres.
    public static func distance(from: Position, to: Position) -> Double {
        hypot(to.x - from.x, to.y - from.y)
    }

    /// Signed area of a ring by the shoelace formula. Positive means counter-clockwise.
    public static func signedRingArea(_ ring: [Position]) -> Double {
        var total = 0.0

        for index in stride(from: 0, to: max(ring.count - 1, 0), by: 1) {
            let current = ring[index]
            let next = ring[index + 1]
            total += current.x * next.y - next.x * current.y
        }

        return total / 2
    }

    /// Absolute area of a ring in square metres.
    public static func ringArea(_ ring: [Position]) -> Double {
        abs(signedRingArea(ring))
    }

    /// Total length of a polyline in metres.
    public static func lineLength(_ line: [Position]) -> Double {
        var total = 0.0

        for index in stride(from: 0, to: max(line.count - 1, 0), by: 1) {
            total += distance(from: line[index], to: line[index + 1])
        }

        return total
    }

    /// True when two positions are the same vertex on the storage grid.
    public static func positionsCoincide(_ left: Position, _ right: Position) -> Bool {
        distance(from: left, to: right) <= GeometryTolerances.vertexEpsilonMetres
    }

    /// True when a ring crosses itself.
    ///
    /// Adjacent segments share a vertex by construction and are skipped, as are
    /// the first and last segments of a closed ring.
    public static func ringSelfIntersects(_ ring: [Position]) -> Bool {
        let segments = ring.count - 1

        guard segments > 0 else { return false }

        for i in 0..<segments {
            for j in stride(from: i + 2, to: segments, by: 1) {
                if i == 0 && j == segments - 1 {
                    continue
                }

                if segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1]) {
                    return true
                }
            }
        }

        return false
    }

    /// Orientation of an ordered triple: 0 collinear, 1 clockwise-positive, 2 otherwise.
    ///
    /// The collinearity threshold is one unit in the last place of 1.0, matching
    /// the TypeScript implementation's use of `Number.EPSILON`. It is a raw
    /// floating-point guard, not a geometric tolerance.
    private static func orientation(_ p: Position, _ q: Position, _ r: Position) -> Int {
        let value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)

        if abs(value) < Double.ulpOfOne {
            return 0
        }

        return value > 0 ? 1 : 2
    }

    private static func onSegment(_ p: Position, _ q: Position, _ r: Position) -> Bool {
        q.x <= max(p.x, r.x)
            && q.x >= min(p.x, r.x)
            && q.y <= max(p.y, r.y)
            && q.y >= min(p.y, r.y)
    }

    private static func segmentsIntersect(
        _ a1: Position,
        _ a2: Position,
        _ b1: Position,
        _ b2: Position
    ) -> Bool {
        let o1 = orientation(a1, a2, b1)
        let o2 = orientation(a1, a2, b2)
        let o3 = orientation(b1, b2, a1)
        let o4 = orientation(b1, b2, a2)

        if o1 != o2 && o3 != o4 {
            return true
        }

        if o1 == 0 && onSegment(a1, b1, a2) { return true }
        if o2 == 0 && onSegment(a1, b2, a2) { return true }
        if o3 == 0 && onSegment(b1, a1, b2) { return true }
        if o4 == 0 && onSegment(b1, a2, b2) { return true }

        return false
    }
}
