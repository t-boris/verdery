import Foundation

/// The only curve family the foundation release persists.
public enum CurveKind: String, Codable, Sendable, CaseIterable {
    case cubicBezier
}

/// Control points for a curve that was densified into stored geometry.
///
/// A cubic Bézier chain of n segments has 3n + 1 control points: each segment
/// contributes two handles and an end point, sharing its start point with the
/// previous segment.
public struct CurveMetadata: Equatable, Sendable, Codable {
    public let kind: CurveKind
    public let controlPoints: [Position]
    /// Chord deviation used when the stored polyline was produced, in metres.
    public let chordDeviationMetres: Double

    public init(
        kind: CurveKind = .cubicBezier,
        controlPoints: [Position],
        chordDeviationMetres: Double = GeometryTolerances.maximumChordDeviationMetres
    ) {
        self.kind = kind
        self.controlPoints = controlPoints
        self.chordDeviationMetres = chordDeviationMetres
    }
}

/// Rejected curve input.
public enum CurveError: Error, Equatable, Sendable {
    case invalidControlPointCount(Int)
    case invalidTolerance(Double)
}

/// Curve densification.
///
/// A curved bed edge or path persists in two parts: an ordinary densified
/// LineString or Polygon that every spatial function and GeoJSON consumer
/// understands, plus ``CurveMetadata`` so the curve stays editable as a curve.
///
/// Consumers that ignore the metadata still receive correct geometry.
///
/// Source: ADR-0010, "Curve persistence".
public enum CubicBezier {
    /// Recursion limit for adaptive subdivision.
    ///
    /// Depth 16 permits 65 536 segments per cubic, far beyond anything a garden
    /// needs. It exists so that a pathological or degenerate curve terminates
    /// rather than exhausting the stack.
    private static let maximumSubdivisionDepth = 16

    /// True when a control-point count can form a cubic Bézier chain.
    public static func isValidControlPointCount(_ count: Int) -> Bool {
        count >= 4 && (count - 1) % 3 == 0
    }

    /// Number of cubic segments implied by a control-point list.
    public static func segmentCount(_ controlPoints: [Position]) -> Int {
        (controlPoints.count - 1) / 3
    }

    /// Densifies a cubic Bézier chain into the polyline that is persisted.
    ///
    /// Subdivision runs in exact arithmetic and rounding is applied once, at
    /// output, so the returned polyline is exactly what the database will hold.
    /// Rounding can move a vertex by at most half the storage grid diagonal
    /// (about 0.71 mm), so the effective deviation from the true curve is the
    /// tolerance plus that rounding — well inside the 10 mm contract for any
    /// garden-scale curve.
    ///
    /// Consecutive vertices that collapse onto the same grid point are dropped,
    /// so the result never contains a zero-length segment.
    ///
    /// - Throws: ``CurveError`` when the control-point count cannot form a cubic
    ///   chain or the tolerance is not positive, and ``CoordinateRangeError``
    ///   when a produced vertex leaves the supported local range.
    public static func densifyChain(
        _ controlPoints: [Position],
        toleranceMetres: Double = GeometryTolerances.maximumChordDeviationMetres
    ) throws -> [Position] {
        guard isValidControlPointCount(controlPoints.count) else {
            throw CurveError.invalidControlPointCount(controlPoints.count)
        }

        guard toleranceMetres > 0 else {
            throw CurveError.invalidTolerance(toleranceMetres)
        }

        var exact: [Position] = [controlPoints[0]]

        for segment in 0..<segmentCount(controlPoints) {
            let base = segment * 3
            subdivide(
                controlPoints[base],
                controlPoints[base + 1],
                controlPoints[base + 2],
                controlPoints[base + 3],
                toleranceMetres: toleranceMetres,
                depth: 0,
                into: &exact
            )
        }

        var polyline: [Position] = []

        for position in exact {
            let rounded = try CoordinateRounding.round(position)

            if polyline.last != rounded {
                polyline.append(rounded)
            }
        }

        return polyline
    }

    private static func midpoint(_ from: Position, _ to: Position) -> Position {
        Position(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2)
    }

    /// Greatest distance from the two interior control points to the chord.
    ///
    /// A Bézier curve lies inside the convex hull of its control points, so this
    /// is a true upper bound on how far the curve departs from its chord. That
    /// makes it safe as a flatness test: if this bound is within tolerance, the
    /// real curve is too.
    private static func chordDeviationBound(
        _ p0: Position,
        _ p1: Position,
        _ p2: Position,
        _ p3: Position
    ) -> Double {
        let chordX = p3.x - p0.x
        let chordY = p3.y - p0.y
        let chordLength = hypot(chordX, chordY)

        if chordLength == 0 {
            return max(
                hypot(p1.x - p0.x, p1.y - p0.y),
                hypot(p2.x - p0.x, p2.y - p0.y)
            )
        }

        func distanceToChord(_ point: Position) -> Double {
            abs(chordX * (p0.y - point.y) - (p0.x - point.x) * chordY) / chordLength
        }

        return max(distanceToChord(p1), distanceToChord(p2))
    }

    /// Splits a cubic segment until every piece is flat within tolerance,
    /// appending each piece's end point.
    ///
    /// Uses de Casteljau subdivision at the midpoint. Subdivision is driven by
    /// the convex-hull bound rather than by a fixed step count, because a fixed
    /// count distributes error unevenly on S-shaped segments and can exceed the
    /// tolerance even when the average error looks acceptable.
    ///
    /// All arithmetic is halving and averaging in IEEE 754 double precision, so
    /// the split points are bit-identical in every runtime.
    private static func subdivide(
        _ p0: Position,
        _ p1: Position,
        _ p2: Position,
        _ p3: Position,
        toleranceMetres: Double,
        depth: Int,
        into output: inout [Position]
    ) {
        if depth >= maximumSubdivisionDepth
            || chordDeviationBound(p0, p1, p2, p3) <= toleranceMetres {
            output.append(p3)
            return
        }

        let p01 = midpoint(p0, p1)
        let p12 = midpoint(p1, p2)
        let p23 = midpoint(p2, p3)
        let p012 = midpoint(p01, p12)
        let p123 = midpoint(p12, p23)
        let middle = midpoint(p012, p123)

        subdivide(p0, p01, p012, middle, toleranceMetres: toleranceMetres, depth: depth + 1, into: &output)
        subdivide(middle, p123, p23, p3, toleranceMetres: toleranceMetres, depth: depth + 1, into: &output)
    }
}
