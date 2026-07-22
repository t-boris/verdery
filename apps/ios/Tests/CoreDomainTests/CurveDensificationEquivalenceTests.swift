import Foundation
import Testing

@testable import CoreDomain

/// Cross-runtime equivalence gate for curve densification.
///
/// The fixture declares exact comparison, so both the subdivision decisions and
/// the produced vertices must match the TypeScript implementation vertex for
/// vertex — not merely stay within the chord tolerance.
///
/// Source: architecture/testing-strategy.md, section "10. Geometry Equivalence";
/// ADR-0010, "Curve persistence".
@Suite("Curve densification equivalence")
struct CurveDensificationEquivalenceTests {
    // Parameterized arguments must be available before any test runs, so a
    // missing or malformed fixture has to fail here rather than inside a case.
    static let fixture: CurveFixture = try! GeometryFixtures.load("geometry/curves.json")

    @Test("The fixture is the schema this port was written against")
    func schemaVersion() {
        #expect(Self.fixture.schemaVersion == 1)
        #expect(Self.fixture.comparison == "exact")
    }

    @Test("Densifies", arguments: fixture.cases)
    func densifies(_ testCase: CurveFixture.Case) throws {
        let polyline = try CubicBezier.densifyChain(
            testCase.controlPoints,
            toleranceMetres: testCase.toleranceMetres
        )

        #expect(polyline == testCase.expectedPolyline)
    }

    @Test("Rejects", arguments: fixture.rejectedCases)
    func rejects(_ testCase: CurveFixture.RejectedCase) {
        let tolerance = testCase.toleranceMetres
            ?? GeometryTolerances.maximumChordDeviationMetres

        let failure = #expect(throws: CurveError.self) {
            try CubicBezier.densifyChain(testCase.controlPoints, toleranceMetres: tolerance)
        }

        switch testCase.reason {
        case .invalidControlPointCount:
            #expect(failure == .invalidControlPointCount(testCase.controlPoints.count))
        case .invalidTolerance:
            #expect(failure == .invalidTolerance(tolerance))
        }
    }
}

@Suite("Curve densification")
struct CurveDensificationTests {
    @Test("A control-point count forms a chain only when it is 3n + 1")
    func controlPointCounts() {
        #expect(!CubicBezier.isValidControlPointCount(0))
        #expect(!CubicBezier.isValidControlPointCount(3))
        #expect(CubicBezier.isValidControlPointCount(4))
        #expect(!CubicBezier.isValidControlPointCount(6))
        #expect(CubicBezier.isValidControlPointCount(7))
    }

    /// Independent check of the contract itself: the produced polyline stays
    /// within the declared chord deviation of the true curve, sampled densely.
    /// This is what makes the fixture trustworthy rather than merely stable.
    @Test("Stays within the declared chord deviation")
    func respectsTolerance() throws {
        let controlPoints = [
            Position(x: 0, y: 0),
            Position(x: 1, y: 2),
            Position(x: 3, y: -2),
            Position(x: 4, y: 0),
        ]
        let tolerance = GeometryTolerances.maximumChordDeviationMetres
        let polyline = try CubicBezier.densifyChain(controlPoints, toleranceMetres: tolerance)

        var worst = 0.0

        for step in 0...500 {
            let sample = pointOnCubic(controlPoints, at: Double(step) / 500)
            var nearest = Double.infinity

            for index in 0..<(polyline.count - 1) {
                nearest = min(
                    nearest,
                    distance(from: sample, toSegment: polyline[index], polyline[index + 1])
                )
            }

            worst = max(worst, nearest)
        }

        // The tolerance bounds subdivision; rounding to the 1 mm grid can move a
        // vertex by at most half the grid diagonal on top of that.
        #expect(worst <= tolerance + GeometryTolerances.coordinatePrecisionMetres)
    }

    private func pointOnCubic(_ controlPoints: [Position], at t: Double) -> Position {
        let inverse = 1 - t
        let a = inverse * inverse * inverse
        let b = 3 * inverse * inverse * t
        let c = 3 * inverse * t * t
        let d = t * t * t

        return Position(
            x: a * controlPoints[0].x + b * controlPoints[1].x + c * controlPoints[2].x
                + d * controlPoints[3].x,
            y: a * controlPoints[0].y + b * controlPoints[1].y + c * controlPoints[2].y
                + d * controlPoints[3].y
        )
    }

    private func distance(from point: Position, toSegment from: Position, _ to: Position) -> Double {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let lengthSquared = dx * dx + dy * dy

        guard lengthSquared > 0 else {
            return hypot(point.x - from.x, point.y - from.y)
        }

        let raw = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared
        let clamped = max(0, min(1, raw))

        return hypot(point.x - (from.x + clamped * dx), point.y - (from.y + clamped * dy))
    }
}
