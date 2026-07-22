import CoreDomain
import Testing

@testable import FeatureMap

@Suite("Map hit testing")
struct MapHitTestingTests {
    private func object(
        id: String,
        geometry: Geometry,
        category: GardenObjectCategory = .tree,
        lifecycleState: ObjectLifecycleState = .active
    ) -> MapRenderObject {
        MapRenderObject(id: id, category: category, geometry: geometry, label: nil, lifecycleState: lifecycleState)
    }

    @Test("A point hits within tolerance and misses outside it")
    func pointToleranceBoundary() {
        let point = Geometry.point(Position(x: 0, y: 0))

        #expect(MapHitTesting.hits(point, at: Position(x: 0.4, y: 0), toleranceMetres: 0.5))
        #expect(!MapHitTesting.hits(point, at: Position(x: 0.6, y: 0), toleranceMetres: 0.5))
    }

    @Test("A line hits near its segment, not only its endpoints")
    func lineHitsAlongSegment() {
        let line = Geometry.lineString([Position(x: 0, y: 0), Position(x: 10, y: 0)])

        #expect(MapHitTesting.hits(line, at: Position(x: 5, y: 0.1), toleranceMetres: 0.5))
        #expect(!MapHitTesting.hits(line, at: Position(x: 5, y: 2), toleranceMetres: 0.5))
    }

    @Test("A polygon hits its interior, not just its boundary")
    func polygonHitsInterior() {
        let square = Geometry.polygon([[
            Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
            Position(x: 0, y: 0),
        ]])

        #expect(MapHitTesting.hits(square, at: Position(x: 5, y: 5), toleranceMetres: 0))
        #expect(!MapHitTesting.hits(square, at: Position(x: 20, y: 20), toleranceMetres: 0))
    }

    @Test("A hole punches a hit through to a miss")
    func polygonHoleExcludesInterior() {
        let exterior = [
            Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
            Position(x: 0, y: 0),
        ]
        let hole = [
            Position(x: 4, y: 4), Position(x: 6, y: 4), Position(x: 6, y: 6), Position(x: 4, y: 6),
            Position(x: 4, y: 4),
        ]
        let withHole = Geometry.polygon([exterior, hole])

        #expect(MapHitTesting.hits(withHole, at: Position(x: 1, y: 1), toleranceMetres: 0))
        #expect(!MapHitTesting.hits(withHole, at: Position(x: 5, y: 5), toleranceMetres: 0))
    }

    @Test("hitTest returns the topmost (last-drawn) match when shapes overlap")
    func hitTestReturnsTopmost() {
        let bottom = object(id: "bottom", geometry: .point(Position(x: 0, y: 0)))
        let top = object(id: "top", geometry: .point(Position(x: 0, y: 0)))

        let hit = MapHitTesting.hitTest(objects: [bottom, top], at: Position(x: 0, y: 0), toleranceMetres: 0.1)

        #expect(hit == "top")
    }

    @Test("hitTest skips deleted objects")
    func hitTestSkipsDeleted() {
        let deleted = object(id: "gone", geometry: .point(Position(x: 0, y: 0)), lifecycleState: .deleted)

        let hit = MapHitTesting.hitTest(objects: [deleted], at: Position(x: 0, y: 0), toleranceMetres: 0.1)

        #expect(hit == nil)
    }

    @Test("hitTest returns nil when nothing is close enough")
    func hitTestReturnsNilForMiss() {
        let far = object(id: "far", geometry: .point(Position(x: 100, y: 100)))

        let hit = MapHitTesting.hitTest(objects: [far], at: Position(x: 0, y: 0), toleranceMetres: 0.5)

        #expect(hit == nil)
    }

    @Test("A MultiLineString hits if any component line is close enough")
    func multiLineStringHitsAnyComponent() {
        let multi = Geometry.multiLineString([
            [Position(x: 0, y: 0), Position(x: 1, y: 0)],
            [Position(x: 20, y: 20), Position(x: 21, y: 20)],
        ])

        #expect(MapHitTesting.hits(multi, at: Position(x: 20.5, y: 20.1), toleranceMetres: 0.5))
    }
}
