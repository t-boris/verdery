import CoreDomain
import Testing

@testable import FeatureMap

@Suite("Map vertex edit commands")
struct MapVertexEditCommandsTests {
    private let square = Geometry.polygon([[
        Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
        Position(x: 0, y: 0),
    ]])

    private let line = Geometry.lineString([
        Position(x: 0, y: 0), Position(x: 5, y: 0), Position(x: 10, y: 0),
    ])

    // MARK: - editableVertices / renderableVertexIndices

    @Test("editableVertices returns the raw stored ring, including a polygon's closing vertex")
    func editableVerticesIncludesClosingVertex() {
        #expect(MapVertexEditCommands.editableVertices(of: square)?.count == 5)
        #expect(MapVertexEditCommands.editableVertices(of: line)?.count == 3)
    }

    @Test("editableVertices is nil for geometry types vertex editing does not support")
    func editableVerticesNilForUnsupportedTypes() {
        #expect(MapVertexEditCommands.editableVertices(of: .point(Position(x: 0, y: 0))) == nil)
        #expect(MapVertexEditCommands.editableVertices(of: .multiPolygon([[[Position(x: 0, y: 0)]]])) == nil)
        #expect(MapVertexEditCommands.editableVertices(of: .multiLineString([[Position(x: 0, y: 0)]])) == nil)
    }

    @Test("renderableVertexIndices excludes a polygon's duplicate closing vertex")
    func renderableIndicesExcludeDuplicateClosingVertex() {
        #expect(MapVertexEditCommands.renderableVertexIndices(of: square) == [0, 1, 2, 3])
    }

    @Test("renderableVertexIndices includes every index of a LineString")
    func renderableIndicesIncludeEveryLineVertex() {
        #expect(MapVertexEditCommands.renderableVertexIndices(of: line) == [0, 1, 2])
    }

    // MARK: - isRingClosureVertex

    @Test("Only index 0 and the final index of a polygon ring are the shared closure vertex")
    func ringClosureVertexDetection() {
        #expect(MapVertexEditCommands.isRingClosureVertex(.polygon, vertexIndex: 0, vertexCount: 5))
        #expect(MapVertexEditCommands.isRingClosureVertex(.polygon, vertexIndex: 4, vertexCount: 5))
        #expect(!MapVertexEditCommands.isRingClosureVertex(.polygon, vertexIndex: 2, vertexCount: 5))
        #expect(!MapVertexEditCommands.isRingClosureVertex(.lineString, vertexIndex: 0, vertexCount: 3))
    }

    // MARK: - movingVertex

    @Test("movingVertex on an interior polygon vertex only moves that one position")
    func movingInteriorPolygonVertex() {
        let moved = MapVertexEditCommands.movingVertex(in: square, vertexIndex: 1, to: Position(x: 20, y: 20))

        guard case let .polygon(rings)? = moved else {
            Issue.record("Expected polygon geometry")
            return
        }
        #expect(rings[0][1] == Position(x: 20, y: 20))
        #expect(rings[0][0] == Position(x: 0, y: 0))
        #expect(rings[0][4] == Position(x: 0, y: 0))
    }

    @Test("movingVertex on the shared start/end vertex moves both copies together")
    func movingClosurePolygonVertex() {
        let moved = MapVertexEditCommands.movingVertex(in: square, vertexIndex: 0, to: Position(x: -5, y: -5))

        guard case let .polygon(rings)? = moved else {
            Issue.record("Expected polygon geometry")
            return
        }
        #expect(rings[0][0] == Position(x: -5, y: -5))
        #expect(rings[0][4] == Position(x: -5, y: -5))
    }

    @Test("movingVertex on a LineString moves only the targeted point")
    func movingLineVertex() {
        let moved = MapVertexEditCommands.movingVertex(in: line, vertexIndex: 1, to: Position(x: 5, y: 5))

        #expect(moved == .lineString([Position(x: 0, y: 0), Position(x: 5, y: 5), Position(x: 10, y: 0)]))
    }

    // MARK: - moveVertexCommand

    @Test("moveVertexCommand builds editVertex for an ordinary vertex")
    func moveVertexCommandOrdinaryVertex() {
        let command = MapVertexEditCommands.moveVertexCommand(
            objectId: "obj-1", expectedRevision: 3, geometry: square, vertexIndex: 1, to: Position(x: 20, y: 20)
        )

        #expect(
            command
                == .editVertex(
                    EditVertexPayload(
                        objectId: "obj-1", expectedRevision: 3, operation: .move,
                        ringIndex: 0, vertexIndex: 1, position: Position(x: 20, y: 20)
                    )
                )
        )
    }

    @Test("moveVertexCommand builds replaceGeometry, not editVertex, for a polygon's shared start/end vertex")
    func moveVertexCommandClosureVertexUsesReplaceGeometry() {
        let command = MapVertexEditCommands.moveVertexCommand(
            objectId: "obj-1", expectedRevision: 3, geometry: square, vertexIndex: 0, to: Position(x: -5, y: -5)
        )

        guard case let .replaceGeometry(payload)? = command else {
            Issue.record("Expected replaceGeometry")
            return
        }
        #expect(payload.objectId == "obj-1")
        #expect(payload.expectedRevision == 3)
        guard case let .polygon(rings) = payload.geometry else {
            Issue.record("Expected polygon geometry")
            return
        }
        #expect(rings[0][0] == Position(x: -5, y: -5))
        #expect(rings[0][4] == Position(x: -5, y: -5))
    }

    @Test("moveVertexCommand is nil for an out-of-range vertex index")
    func moveVertexCommandNilOutOfRange() {
        #expect(
            MapVertexEditCommands.moveVertexCommand(
                objectId: "obj-1", expectedRevision: 1, geometry: line, vertexIndex: 99, to: Position(x: 0, y: 0)
            ) == nil
        )
    }

    @Test("moveVertexCommand is nil for a Point geometry")
    func moveVertexCommandNilForPoint() {
        #expect(
            MapVertexEditCommands.moveVertexCommand(
                objectId: "obj-1", expectedRevision: 1, geometry: .point(Position(x: 0, y: 0)), vertexIndex: 0,
                to: Position(x: 1, y: 1)
            ) == nil
        )
    }

    // MARK: - midpoint / insertVertexCommand

    @Test("midpoint returns the exact midpoint of the edge into beforeIndex")
    func midpointComputesEdgeMidpoint() {
        #expect(MapVertexEditCommands.midpoint(of: line, beforeIndex: 1) == Position(x: 2.5, y: 0))
        #expect(MapVertexEditCommands.midpoint(of: line, beforeIndex: 2) == Position(x: 7.5, y: 0))
    }

    @Test("midpoint is nil for a beforeIndex with no corresponding edge")
    func midpointNilOutOfRange() {
        #expect(MapVertexEditCommands.midpoint(of: line, beforeIndex: 0) == nil)
        #expect(MapVertexEditCommands.midpoint(of: line, beforeIndex: 3) == nil)
    }

    @Test("midpointBeforeIndices covers every edge of a polygon ring, including the edge into the closing vertex")
    func midpointBeforeIndicesCoverEveryEdge() {
        #expect(MapVertexEditCommands.midpointBeforeIndices(of: square) == [1, 2, 3, 4])
    }

    @Test("insertVertexCommand carries the edge midpoint as the new position")
    func insertVertexCommandCarriesMidpoint() {
        let command = MapVertexEditCommands.insertVertexCommand(
            objectId: "obj-1", expectedRevision: 2, geometry: line, beforeIndex: 1
        )

        #expect(
            command
                == .editVertex(
                    EditVertexPayload(
                        objectId: "obj-1", expectedRevision: 2, operation: .insert,
                        ringIndex: 0, vertexIndex: 1, position: Position(x: 2.5, y: 0)
                    )
                )
        )
    }

    // MARK: - canRemoveVertex / removeVertexCommand

    @Test("canRemoveVertex refuses the shared start/end vertex of a closed ring")
    func cannotRemoveClosureVertex() {
        #expect(!MapVertexEditCommands.canRemoveVertex(geometry: square, vertexIndex: 0))
        #expect(!MapVertexEditCommands.canRemoveVertex(geometry: square, vertexIndex: 4))
    }

    @Test("canRemoveVertex allows dropping a 4-corner ring to a 3-corner triangle")
    func canRemoveDownToMinimumRingCount() {
        // 5 stored points (4 corners + closing vertex); removing one interior
        // corner leaves 4 stored points — a triangle, exactly
        // `minimumRingVertexCount`, still a valid ring.
        #expect(MapVertexEditCommands.canRemoveVertex(geometry: square, vertexIndex: 1))
    }

    @Test("canRemoveVertex refuses to drop a ring below the minimum vertex count")
    func cannotRemoveBelowMinimumRingCount() {
        // A triangle: 4 stored points (3 corners + closing vertex), already
        // at `minimumRingVertexCount` (4) — removing its one interior corner
        // would drop it to 3, below the floor.
        let triangle = Geometry.polygon([[
            Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 5, y: 10), Position(x: 0, y: 0),
        ]])
        #expect(!MapVertexEditCommands.canRemoveVertex(geometry: triangle, vertexIndex: 1))
    }

    @Test("canRemoveVertex allows an interior line vertex above the minimum")
    func canRemoveInteriorLineVertex() {
        #expect(MapVertexEditCommands.canRemoveVertex(geometry: line, vertexIndex: 1))
    }

    @Test("canRemoveVertex refuses to drop a line below the minimum vertex count")
    func cannotRemoveBelowMinimumLineCount() {
        let twoPointLine = Geometry.lineString([Position(x: 0, y: 0), Position(x: 1, y: 0)])
        #expect(!MapVertexEditCommands.canRemoveVertex(geometry: twoPointLine, vertexIndex: 0))
    }

    @Test("removeVertexCommand returns nil when canRemoveVertex is false")
    func removeVertexCommandRespectsGuard() {
        #expect(
            MapVertexEditCommands.removeVertexCommand(
                objectId: "obj-1", expectedRevision: 1, geometry: square, vertexIndex: 0
            ) == nil
        )
    }

    @Test("removeVertexCommand builds editVertex(.remove) with no position")
    func removeVertexCommandBuildsPayload() {
        let longerLine = Geometry.lineString([
            Position(x: 0, y: 0), Position(x: 1, y: 0), Position(x: 2, y: 0), Position(x: 3, y: 0),
        ])

        let command = MapVertexEditCommands.removeVertexCommand(
            objectId: "obj-1", expectedRevision: 5, geometry: longerLine, vertexIndex: 1
        )

        #expect(
            command
                == .editVertex(
                    EditVertexPayload(
                        objectId: "obj-1", expectedRevision: 5, operation: .remove, ringIndex: 0, vertexIndex: 1
                    )
                )
        )
    }

    // MARK: - canSplit

    @Test("canSplit accepts only an interior LineString vertex")
    func canSplitInteriorVertexOnly() {
        #expect(!MapVertexEditCommands.canSplit(geometry: line, atVertexIndex: 0))
        #expect(MapVertexEditCommands.canSplit(geometry: line, atVertexIndex: 1))
        #expect(!MapVertexEditCommands.canSplit(geometry: line, atVertexIndex: 2))
    }

    @Test("canSplit is false for a Polygon")
    func canSplitFalseForPolygon() {
        #expect(!MapVertexEditCommands.canSplit(geometry: square, atVertexIndex: 1))
    }
}
