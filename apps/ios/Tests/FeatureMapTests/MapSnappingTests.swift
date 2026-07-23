import CoreDomain
import Foundation
import Testing

@testable import FeatureMap

@Suite("Map snapping")
struct MapSnappingTests {
    private func object(id: String, geometry: Geometry, category: GardenObjectCategory = .structure) -> MapRenderObject {
        MapRenderObject(id: id, category: category, geometry: geometry, label: nil, lifecycleState: .active)
    }

    private let square = Geometry.polygon([[
        Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
        Position(x: 0, y: 0),
    ]])

    // MARK: - referencePosition

    @Test("referencePosition for a polygon is the previous vertex in ring order")
    func referencePositionPolygonPreviousInRing() {
        #expect(MapSnapping.referencePosition(in: square, vertexIndex: 2) == Position(x: 10, y: 0))
    }

    @Test("referencePosition for a polygon's first vertex wraps to the vertex before the closing duplicate")
    func referencePositionPolygonWrapsAtFirstVertex() {
        #expect(MapSnapping.referencePosition(in: square, vertexIndex: 0) == Position(x: 0, y: 10))
    }

    @Test("referencePosition for a LineString's first vertex falls back to its successor")
    func referencePositionLineFirstVertexFallsBackToSuccessor() {
        let line = Geometry.lineString([Position(x: 0, y: 0), Position(x: 5, y: 0), Position(x: 10, y: 0)])
        #expect(MapSnapping.referencePosition(in: line, vertexIndex: 0) == Position(x: 5, y: 0))
    }

    @Test("referencePosition for an interior LineString vertex is its predecessor")
    func referencePositionLineInteriorVertexIsPredecessor() {
        let line = Geometry.lineString([Position(x: 0, y: 0), Position(x: 5, y: 0), Position(x: 10, y: 0)])
        #expect(MapSnapping.referencePosition(in: line, vertexIndex: 2) == Position(x: 5, y: 0))
    }

    @Test("referencePosition is nil for a geometry type vertex editing does not support")
    func referencePositionNilForUnsupportedType() {
        #expect(MapSnapping.referencePosition(in: .point(Position(x: 0, y: 0)), vertexIndex: 0) == nil)
    }

    // MARK: - snapToVertex

    @Test("snapToVertex snaps onto the nearest vertex within tolerance")
    func snapToVertexSnapsWithinTolerance() {
        let result = MapSnapping.snapToVertex(
            candidate: Position(x: 10.05, y: 10.05),
            vertices: [Position(x: 0, y: 0), Position(x: 10, y: 10)],
            toleranceMetres: 0.2
        )
        #expect(result == Position(x: 10, y: 10))
    }

    @Test("snapToVertex returns nil when nothing is close enough")
    func snapToVertexNilOutOfTolerance() {
        let result = MapSnapping.snapToVertex(
            candidate: Position(x: 5, y: 5),
            vertices: [Position(x: 0, y: 0), Position(x: 10, y: 10)],
            toleranceMetres: 0.2
        )
        #expect(result == nil)
    }

    @Test("snapToVertex picks the closest vertex when more than one is in range")
    func snapToVertexPicksClosest() {
        let result = MapSnapping.snapToVertex(
            candidate: Position(x: 0.1, y: 0),
            vertices: [Position(x: 0, y: 0), Position(x: 0.15, y: 0)],
            toleranceMetres: 0.5
        )
        #expect(result == Position(x: 0.15, y: 0))
    }

    // MARK: - snapToEdge

    @Test("snapToEdge projects onto the nearest segment, clamped, within tolerance")
    func snapToEdgeProjectsOntoSegment() {
        let result = MapSnapping.snapToEdge(
            candidate: Position(x: 5, y: 0.1),
            edges: [(Position(x: 0, y: 0), Position(x: 10, y: 0))],
            toleranceMetres: 0.2
        )
        #expect(result == Position(x: 5, y: 0))
    }

    @Test("snapToEdge clamps the projection to the segment's endpoints")
    func snapToEdgeClampsToSegment() {
        let result = MapSnapping.snapToEdge(
            candidate: Position(x: -1, y: 0.1),
            edges: [(Position(x: 0, y: 0), Position(x: 10, y: 0))],
            toleranceMetres: 1.5
        )
        #expect(result == Position(x: 0, y: 0))
    }

    @Test("snapToEdge returns nil when nothing is close enough")
    func snapToEdgeNilOutOfTolerance() {
        let result = MapSnapping.snapToEdge(
            candidate: Position(x: 5, y: 5),
            edges: [(Position(x: 0, y: 0), Position(x: 10, y: 0))],
            toleranceMetres: 0.2
        )
        #expect(result == nil)
    }

    // MARK: - snapToAxis (horizontal/vertical)

    @Test("snapToAxis snaps y to the reference when near-horizontal but not exact")
    func snapToAxisSnapsNearHorizontal() {
        let result = MapSnapping.snapToAxis(
            candidate: Position(x: 8, y: 0.04),
            reference: Position(x: 0, y: 0),
            toleranceMetres: 0.1
        )
        #expect(result == MapSnapResult(position: Position(x: 8, y: 0), kind: .horizontal))
    }

    @Test("snapToAxis snaps x to the reference when near-vertical but not exact")
    func snapToAxisSnapsNearVertical() {
        let result = MapSnapping.snapToAxis(
            candidate: Position(x: 0.03, y: 8),
            reference: Position(x: 0, y: 0),
            toleranceMetres: 0.1
        )
        #expect(result == MapSnapResult(position: Position(x: 0, y: 8), kind: .vertical))
    }

    @Test("snapToAxis prefers the smaller deviation when both axes qualify")
    func snapToAxisPrefersSmallerDeviation() {
        let result = MapSnapping.snapToAxis(
            candidate: Position(x: 0.02, y: 0.08),
            reference: Position(x: 0, y: 0),
            toleranceMetres: 0.1
        )
        #expect(result?.kind == .vertical)
    }

    @Test("snapToAxis returns nil when neither axis is close enough")
    func snapToAxisNilOutOfTolerance() {
        let result = MapSnapping.snapToAxis(
            candidate: Position(x: 5, y: 5),
            reference: Position(x: 0, y: 0),
            toleranceMetres: 0.1
        )
        #expect(result == nil)
    }

    // MARK: - snapToAngleIncrement

    @Test("snapToAngleIncrement leaves a position exactly on a 45 degree angle unchanged")
    func snapToAngleIncrementExactlyOnIncrement() {
        let reference = Position(x: 0, y: 0)
        let candidate = Position(x: 3, y: 3) // exactly 45 degrees from the reference.

        let result = MapSnapping.snapToAngleIncrement(candidate: candidate, reference: reference)

        #expect(result?.kind == .angleIncrement)
        #expect(abs((result?.position.x ?? .nan) - 3) < 0.0001)
        #expect(abs((result?.position.y ?? .nan) - 3) < 0.0001)
    }

    @Test("snapToAngleIncrement rotates a near-45-degree candidate onto the increment, preserving distance")
    func snapToAngleIncrementRotatesOntoIncrement() {
        let reference = Position(x: 0, y: 0)
        let candidate = Position(x: 3, y: 3.2) // slightly past 45 degrees.
        let originalDistance = GeometryMeasurement.distance(from: reference, to: candidate)

        let result = MapSnapping.snapToAngleIncrement(candidate: candidate, reference: reference)

        guard let result else {
            Issue.record("Expected an angle-increment snap")
            return
        }
        #expect(result.kind == .angleIncrement)
        let snappedDistance = GeometryMeasurement.distance(from: reference, to: result.position)
        #expect(abs(snappedDistance - originalDistance) < 0.0001)
        // On the 45-degree line, x and y are equal.
        #expect(abs(result.position.x - result.position.y) < 0.0001)
    }

    @Test("snapToAngleIncrement returns nil when the angle is not close to any increment")
    func snapToAngleIncrementNilOutOfTolerance() {
        let result = MapSnapping.snapToAngleIncrement(candidate: Position(x: 10, y: 3), reference: Position(x: 0, y: 0))
        #expect(result == nil)
    }

    @Test("snapToAngleIncrement returns nil when the candidate coincides with the reference")
    func snapToAngleIncrementNilAtZeroDistance() {
        let point = Position(x: 4, y: 4)
        #expect(MapSnapping.snapToAngleIncrement(candidate: point, reference: point) == nil)
    }

    // MARK: - snapToRoundDistance

    @Test("snapToRoundDistance leaves a position exactly at a round distance unchanged")
    func snapToRoundDistanceExactlyAtRoundValue() {
        let reference = Position(x: 0, y: 0)
        // 30 degrees from the reference (not a 45-degree multiple), distance 3.0 exactly.
        let candidate = Position(x: 3 * cos(30 * .pi / 180), y: 3 * sin(30 * .pi / 180))

        let result = MapSnapping.snapToRoundDistance(candidate: candidate, reference: reference)

        #expect(result?.kind == .roundDistance)
        #expect(abs((result?.position.x ?? .nan) - candidate.x) < 0.0001)
        #expect(abs((result?.position.y ?? .nan) - candidate.y) < 0.0001)
    }

    @Test("snapToRoundDistance scales a near-round distance onto the grid, preserving angle")
    func snapToRoundDistanceScalesPreservingAngle() {
        let reference = Position(x: 0, y: 0)
        let candidate = Position(x: 3 * cos(30 * .pi / 180) + 0.05, y: 3 * sin(30 * .pi / 180))

        let result = MapSnapping.snapToRoundDistance(candidate: candidate, reference: reference)

        guard let result else {
            Issue.record("Expected a round-distance snap")
            return
        }
        let snappedDistance = GeometryMeasurement.distance(from: reference, to: result.position)
        #expect(abs(snappedDistance - 3.0) < 0.0001)
    }

    @Test("snapToRoundDistance returns nil when the distance is not close to any round value")
    func snapToRoundDistanceNilOutOfTolerance() {
        let result = MapSnapping.snapToRoundDistance(candidate: Position(x: 3.25, y: 0), reference: Position(x: 0, y: 0))
        #expect(result == nil)
    }

    @Test("snapToRoundDistance returns nil when the candidate coincides with the reference")
    func snapToRoundDistanceNilAtZeroDistance() {
        let point = Position(x: 4, y: 4)
        #expect(MapSnapping.snapToRoundDistance(candidate: point, reference: point) == nil)
    }

    // MARK: - snap (overall priority-ordered entry point)

    @Test("snap prefers vertex snapping over every other target")
    func snapPrefersVertex() {
        let other = object(id: "other", geometry: .point(Position(x: 10, y: 10)))
        let dragged = object(id: "dragged", geometry: square)

        let result = MapSnapping.snap(
            candidate: Position(x: 10.05, y: 10.02),
            objects: [dragged, other],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: Position(x: 0, y: 0),
            toleranceMetres: 0.2
        )

        #expect(result == MapSnapResult(position: Position(x: 10, y: 10), kind: .vertex))
    }

    @Test("snap falls back to an edge when nothing vertex-level qualifies")
    func snapFallsBackToEdge() {
        let fence = object(
            id: "fence",
            geometry: .lineString([Position(x: 0, y: 20), Position(x: 20, y: 20)]),
            category: .fence
        )

        let result = MapSnapping.snap(
            candidate: Position(x: 10, y: 20.05),
            objects: [fence],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: nil,
            toleranceMetres: 0.2
        )

        #expect(result == MapSnapResult(position: Position(x: 10, y: 20), kind: .edge))
    }

    @Test("snap falls back to axis alignment when nothing geometry-level qualifies")
    func snapFallsBackToAxis() {
        let result = MapSnapping.snap(
            candidate: Position(x: 8, y: 0.04),
            objects: [],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: Position(x: 0, y: 0),
            toleranceMetres: 0.2
        )

        #expect(result == MapSnapResult(position: Position(x: 8, y: 0), kind: .horizontal))
    }

    @Test("snap passes a candidate nowhere near any target through unchanged")
    func snapPassesThroughUnchanged() {
        let far = object(id: "far", geometry: .point(Position(x: 500, y: 500)))
        // Neither axis matches (both deltas are large), the angle from the
        // reference (~55 degrees) is well outside tolerance of a 45-degree
        // multiple, and the distance (~5.24 m) is well outside tolerance of
        // a 0.5 m multiple (nearest is 5.0 m, off by ~0.24 m).
        let candidate = Position(x: 3, y: 4.3)

        let result = MapSnapping.snap(
            candidate: candidate,
            objects: [far],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: Position(x: 0, y: 0),
            toleranceMetres: 0.2
        )

        #expect(result == MapSnapResult(position: candidate, kind: nil))
    }

    @Test("snap excludes the dragged vertex itself from vertex snapping")
    func snapExcludesDraggedVertexFromVertexTargets() {
        let dragged = object(id: "dragged", geometry: square)

        // Candidate sits right where the dragged vertex (0, 0) started; with
        // no exclusion this would spuriously "snap" onto its own pre-drag
        // position.
        let result = MapSnapping.snap(
            candidate: Position(x: 0.02, y: 0.01),
            objects: [dragged],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: nil,
            toleranceMetres: 0.2
        )

        #expect(result.kind == nil)
    }

    @Test("snap excludes the two edges touching the dragged vertex from edge snapping")
    func snapExcludesEdgesTouchingDraggedVertex() {
        let dragged = object(id: "dragged", geometry: square)

        // (5, 0.05) is close to the bottom edge (0,0)-(10,0), which touches
        // the dragged vertex (0, 0); it must not snap there. It is far from
        // every other edge/vertex of the same square.
        let result = MapSnapping.snap(
            candidate: Position(x: 5, y: 0.05),
            objects: [dragged],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: nil,
            toleranceMetres: 0.2
        )

        #expect(result.kind == nil)
    }

    @Test("snap still targets a non-adjacent edge/vertex of the same object")
    func snapStillTargetsNonAdjacentPartsOfSameObject() {
        let dragged = object(id: "dragged", geometry: square)

        // (10, 10.05) is close to vertex (10, 10), which is not the dragged
        // vertex (0, 0) and not adjacent to it either.
        let result = MapSnapping.snap(
            candidate: Position(x: 10, y: 10.05),
            objects: [dragged],
            excludedObjectId: "dragged",
            excludedVertexPosition: Position(x: 0, y: 0),
            referencePoint: nil,
            toleranceMetres: 0.2
        )

        #expect(result == MapSnapResult(position: Position(x: 10, y: 10), kind: .vertex))
    }
}
