import CoreDomain

/// Pure hit testing against a render snapshot.
///
/// Takes a tap already converted to garden-local metres by
/// ``MapViewportTransform``, so this logic has no dependency on `Canvas`,
/// `DragGesture`, or any other SwiftUI type — the same reason the transform
/// itself is a plain value type. `swift test` exercises exactly the logic
/// `MapCanvasView`'s tap handler calls.
public enum MapHitTesting {
    /// Returns the id of the topmost active object whose geometry is within
    /// `toleranceMetres` of `local`, or `nil` when nothing qualifies.
    ///
    /// "Topmost" is last-drawn — later entries in `objects` — matching how
    /// `MapCanvasView` draws the array in order, so the object a user
    /// perceives as on top is also the one hit-tested first.
    public static func hitTest(
        objects: [MapRenderObject],
        at local: Position,
        toleranceMetres: Double
    ) -> String? {
        for object in objects.reversed() where object.lifecycleState == .active {
            if hits(object.geometry, at: local, toleranceMetres: toleranceMetres) {
                return object.id
            }
        }

        return nil
    }

    /// True when `local` is within `toleranceMetres` of one specific object's
    /// geometry — what a drag gesture's start point uses to decide "does this
    /// drag begin on the currently selected object" before treating the
    /// gesture as a pan instead.
    public static func hits(_ geometry: Geometry, at local: Position, toleranceMetres: Double) -> Bool {
        switch geometry {
        case let .point(position):
            return GeometryMeasurement.distance(from: position, to: local) <= toleranceMetres

        case let .lineString(line):
            return distanceToPolyline(line, from: local) <= toleranceMetres

        case let .multiLineString(lines):
            return lines.contains { distanceToPolyline($0, from: local) <= toleranceMetres }

        case let .polygon(rings):
            return pointInPolygon(local, rings: rings)

        case let .multiPolygon(polygons):
            return polygons.contains { pointInPolygon(local, rings: $0) }
        }
    }

    private static func distanceToPolyline(_ line: [Position], from point: Position) -> Double {
        guard line.count >= 2 else {
            return line.first.map { GeometryMeasurement.distance(from: $0, to: point) } ?? .infinity
        }

        var minimum = Double.infinity

        for index in 0..<(line.count - 1) {
            minimum = min(minimum, distanceToSegment(point, line[index], line[index + 1]))
        }

        return minimum
    }

    private static func distanceToSegment(_ point: Position, _ a: Position, _ b: Position) -> Double {
        let deltaX = b.x - a.x
        let deltaY = b.y - a.y
        let lengthSquared = deltaX * deltaX + deltaY * deltaY

        guard lengthSquared > 0 else {
            return GeometryMeasurement.distance(from: a, to: point)
        }

        let t = min(1, max(0, ((point.x - a.x) * deltaX + (point.y - a.y) * deltaY) / lengthSquared))
        let projection = Position(x: a.x + t * deltaX, y: a.y + t * deltaY)

        return GeometryMeasurement.distance(from: projection, to: point)
    }

    /// Ray-casting point-in-polygon test. The exterior ring must contain the
    /// point and no hole ring may — a hole punches the tap through to "not
    /// hit," matching how a hole reads visually.
    ///
    /// A `MultiPolygon`'s per-polygon ring list is passed through as-is;
    /// there is no further "which polygon of the multi" distinction needed
    /// here beyond what the caller already iterates.
    private static func pointInPolygon(_ point: Position, rings: [[Position]]) -> Bool {
        guard let exterior = rings.first, rayCastContains(point, exterior) else { return false }

        for hole in rings.dropFirst() where rayCastContains(point, hole) {
            return false
        }

        return true
    }

    private static func rayCastContains(_ point: Position, _ ring: [Position]) -> Bool {
        guard ring.count >= 3 else { return false }

        var inside = false
        var previous = ring.count - 1

        for index in 0..<ring.count {
            let current = ring[index]
            let prior = ring[previous]

            let straddles = (current.y > point.y) != (prior.y > point.y)
            if straddles {
                let xAtPointY = (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x
                if point.x < xAtPointY {
                    inside.toggle()
                }
            }

            previous = index
        }

        return inside
    }
}
