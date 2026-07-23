import CoreDomain
import CoreGraphics
import Testing

@testable import FeatureMap

@Suite("Map shape transform")
struct MapShapeTransformTests {
    private let square = Geometry.polygon([[
        Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
        Position(x: 0, y: 0),
    ]])

    // MARK: - centroid

    @Test("centroid excludes the repeated closing vertex")
    func centroidExcludesClosingVertex() {
        #expect(MapShapeTransform.centroid(ofRing: [
            Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
            Position(x: 0, y: 0),
        ]) == Position(x: 5, y: 5))
    }

    @Test("centroid is nil for an empty ring")
    func centroidNilForEmptyRing() {
        #expect(MapShapeTransform.centroid(ofRing: []) == nil)
    }

    @Test("polygonCentroid is nil for a non-Polygon geometry")
    func polygonCentroidNilForNonPolygon() {
        #expect(MapShapeTransform.polygonCentroid(.lineString([Position(x: 0, y: 0), Position(x: 1, y: 0)])) == nil)
        #expect(MapShapeTransform.polygonCentroid(.point(Position(x: 0, y: 0))) == nil)
    }

    // MARK: - scaled / rotated

    @Test("scaled moves a position away from the center proportionally to factor")
    func scaledScalesAroundCenter() {
        let scaled = MapShapeTransform.scaled(Position(x: 10, y: 0), factor: 2, around: Position(x: 0, y: 0))
        #expect(scaled == Position(x: 20, y: 0))
    }

    @Test("scaled by 1 leaves a position unchanged")
    func scaledByOneIsIdentity() {
        let position = Position(x: 3, y: 7)
        let scaled = MapShapeTransform.scaled(position, factor: 1, around: Position(x: 1, y: 1))
        #expect(scaled == position)
    }

    @Test("rotated by 90 degrees maps east to north (counter-clockwise-positive)")
    func rotatedNinetyDegreesEastToNorth() {
        let rotated = MapShapeTransform.rotated(Position(x: 1, y: 0), degrees: 90, around: Position(x: 0, y: 0))

        #expect(abs(rotated.x - 0) < 0.0001)
        #expect(abs(rotated.y - 1) < 0.0001)
    }

    @Test("rotated by 360 degrees returns to the original position")
    func rotatedFullCircleIsIdentity() {
        let original = Position(x: 4, y: 2)
        let rotated = MapShapeTransform.rotated(original, degrees: 360, around: Position(x: 1, y: 1))

        #expect(abs(rotated.x - original.x) < 0.0001)
        #expect(abs(rotated.y - original.y) < 0.0001)
    }

    // MARK: - resizedGeometry / rotatedGeometry

    @Test("resizedGeometry scales every vertex around the polygon's centroid")
    func resizedGeometryScalesAroundCentroid() {
        guard let resized = MapShapeTransform.resizedGeometry(square, factor: 2),
            case let .polygon(rings) = resized
        else {
            Issue.record("Expected resized polygon geometry")
            return
        }

        // Centroid (5, 5); doubling the 10x10 square around it produces a
        // 20x20 square from (-5, -5) to (15, 15).
        #expect(rings[0][0] == Position(x: -5, y: -5))
        #expect(rings[0][2] == Position(x: 15, y: 15))
    }

    @Test("resizedGeometry is nil for a non-positive or non-finite factor")
    func resizedGeometryRejectsInvalidFactor() {
        #expect(MapShapeTransform.resizedGeometry(square, factor: 0) == nil)
        #expect(MapShapeTransform.resizedGeometry(square, factor: -1) == nil)
        #expect(MapShapeTransform.resizedGeometry(square, factor: .infinity) == nil)
    }

    @Test("resizedGeometry is nil for a non-Polygon geometry")
    func resizedGeometryNilForNonPolygon() {
        #expect(MapShapeTransform.resizedGeometry(.point(Position(x: 0, y: 0)), factor: 2) == nil)
    }

    @Test("rotatedGeometry by 360 degrees reproduces the original ring")
    func rotatedGeometryFullCircle() {
        guard let rotated = MapShapeTransform.rotatedGeometry(square, degrees: 360),
            case let .polygon(rings) = rotated
        else {
            Issue.record("Expected rotated polygon geometry")
            return
        }

        for (original, result) in zip([Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10)], rings[0]) {
            #expect(abs(result.x - original.x) < 0.0001)
            #expect(abs(result.y - original.y) < 0.0001)
        }
    }

    @Test("rotatedGeometry is nil for a non-Polygon geometry")
    func rotatedGeometryNilForNonPolygon() {
        #expect(MapShapeTransform.rotatedGeometry(.lineString([Position(x: 0, y: 0), Position(x: 1, y: 0)]), degrees: 45) == nil)
    }

    // MARK: - Screen-space gesture math

    @Test("resizeFactor is the ratio of end to start distance from the centroid")
    func resizeFactorComputesDistanceRatio() {
        let centroid = CGPoint(x: 100, y: 100)
        let start = CGPoint(x: 110, y: 100) // 10pt from centroid
        let end = CGPoint(x: 130, y: 100) // 30pt from centroid

        let factor = MapShapeTransform.resizeFactor(centroidScreen: centroid, startScreen: start, endScreen: end)
        #expect(abs(factor - 3) < 0.0001)
    }

    @Test("resizeFactor falls back to 1 when the start point coincides with the centroid")
    func resizeFactorFallsBackWhenStartAtCentroid() {
        let centroid = CGPoint(x: 50, y: 50)
        let factor = MapShapeTransform.resizeFactor(centroidScreen: centroid, startScreen: centroid, endScreen: CGPoint(x: 60, y: 50))
        #expect(factor == 1)
    }

    @Test("rotationDegrees negates the raw screen-angle delta to match local CCW-positive space")
    func rotationDegreesNegatesScreenDelta() {
        let centroid = CGPoint(x: 0, y: 0)
        // Directly above the centroid on screen (screen y grows downward).
        let start = CGPoint(x: 0, y: -10)
        // Directly to the right of the centroid on screen — a visually
        // clockwise quarter-turn drag (top → right).
        let end = CGPoint(x: 10, y: 0)

        let degrees = MapShapeTransform.rotationDegrees(centroidScreen: centroid, startScreen: start, endScreen: end)

        // A clockwise screen drag is a clockwise (negative, CCW-positive
        // convention) local rotation — see this function's own doc comment.
        #expect(abs(degrees - (-90)) < 0.0001)
    }

    @Test("rotationDegrees round-trips through rotated(_:degrees:around:) consistently")
    func rotationDegreesRoundTripsWithRotated() {
        // A pure algebraic sanity check independent of any screen mirroring:
        // rotating a point by the angle this function reports between two
        // other points, around the same center, reproduces the second point.
        let center = Position(x: 0, y: 0)
        let from = Position(x: 10, y: 0)
        let to = Position(x: 0, y: 10) // 90 degrees CCW from `from`.

        let centroidScreen = CGPoint(x: 0, y: 0)
        let startScreen = CGPoint(x: from.x, y: -from.y)
        let endScreen = CGPoint(x: to.x, y: -to.y)

        let degrees = MapShapeTransform.rotationDegrees(centroidScreen: centroidScreen, startScreen: startScreen, endScreen: endScreen)
        let rotated = MapShapeTransform.rotated(from, degrees: degrees, around: center)

        #expect(abs(rotated.x - to.x) < 0.0001)
        #expect(abs(rotated.y - to.y) < 0.0001)
    }
}
