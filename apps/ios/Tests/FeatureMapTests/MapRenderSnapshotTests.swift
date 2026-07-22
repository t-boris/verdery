import CoreDomain
import Testing

@testable import FeatureMap

@Suite("Map render snapshot")
struct MapRenderSnapshotTests {
    @Test("Bounds is empty when there are no objects")
    func emptySnapshotUsesEmptyBounds() {
        #expect(MapRenderSnapshot(objects: []).bounds == .empty)
    }

    @Test("Bounds is the union of every object's positions")
    func boundsUnionsAllPositions() {
        let objects = [
            MapRenderObject(id: "1", category: .tree, geometry: .point(Position(x: -3, y: 2)), label: nil, lifecycleState: .active),
            MapRenderObject(
                id: "2",
                category: .lot,
                geometry: .polygon([[
                    Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 5), Position(x: 0, y: 5),
                    Position(x: 0, y: 0),
                ]]),
                label: nil,
                lifecycleState: .active
            ),
        ]

        let bounds = MapRenderSnapshot(objects: objects).bounds

        #expect(bounds.minX == -3)
        #expect(bounds.minY == 0)
        #expect(bounds.maxX == 10)
        #expect(bounds.maxY == 5)
    }

    @Test(
        "Render kind follows the geometry's own type",
        arguments: [
            (GeometryType.point, MapObjectRenderKind.marker),
            (GeometryType.lineString, MapObjectRenderKind.line),
            (GeometryType.multiLineString, MapObjectRenderKind.line),
            (GeometryType.polygon, MapObjectRenderKind.area),
            (GeometryType.multiPolygon, MapObjectRenderKind.area),
        ]
    )
    func renderKindMatchesGeometryType(_ pair: (GeometryType, MapObjectRenderKind)) {
        #expect(MapObjectRenderKind(geometryType: pair.0) == pair.1)
    }

    @Test("Every category maps to a distinct colour token — a one-to-one correspondence, not a shared fallback")
    func categoryColorTokensAreDistinct() {
        let tokens = GardenObjectCategory.allCases.map(MapObjectColorToken.init)

        #expect(Set(tokens).count == GardenObjectCategory.allCases.count)
        #expect(MapObjectColorToken.allCases.count == GardenObjectCategory.allCases.count)
    }
}
