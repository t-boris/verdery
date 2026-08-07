import Foundation

/// Whether a point lies inside a polygon, holes included.
///
/// Hoisted out of `FeatureMap.MapHitTesting`, which is where it grew and where
/// it is still used. The capture flow needs the same question answered — which
/// bed is the phone standing in — and a feature may never import a sibling
/// feature, so the shared half moves down to the geometry it always belonged
/// to, beside `GeometryValidation`.
///
/// Ray casting rather than a winding number: the rings this operates on are
/// simple by construction (`GeometryValidation` rejects self-intersecting
/// ones), and a half-open crossing rule gives a point exactly on a shared edge
/// to one polygon rather than to both or to neither.
public enum PolygonContainment {
    /// - Parameter rings: exterior first, holes after — the GeoJSON order this
    ///   product's geometry already uses.
    public static func contains(_ point: Position, rings: [[Position]]) -> Bool {
        guard let exterior = rings.first, rayCastContains(point, exterior) else { return false }

        for hole in rings.dropFirst() where rayCastContains(point, hole) {
            return false
        }

        return true
    }

    /// Any polygon of a geometry, or `false` for anything that is not one.
    ///
    /// A point, a line and a rectangle are not places one can stand *inside*,
    /// so a caller asking "which object am I in" gets an honest no rather than
    /// a nearest-thing guess.
    public static func contains(_ point: Position, in geometry: Geometry) -> Bool {
        switch geometry {
        case let .polygon(rings):
            return contains(point, rings: rings)
        case let .multiPolygon(polygons):
            return polygons.contains { contains(point, rings: $0) }
        case .point, .lineString, .multiLineString:
            return false
        }
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
                let xAtPointY =
                    (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y)
                    + current.x
                if point.x < xAtPointY {
                    inside.toggle()
                }
            }
            previous = index
        }

        return inside
    }
}
