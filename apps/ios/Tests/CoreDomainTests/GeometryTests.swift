import Foundation
import Testing

@testable import CoreDomain

@Suite("Geometry model")
struct GeometryTests {
    @Test("Rounding applies to every coordinate of every rank")
    func roundsNestedCoordinates() throws {
        let polygon = Geometry.polygon([
            [
                Position(x: 0.00049, y: 0),
                Position(x: 1.23451, y: 0),
                Position(x: 1.23451, y: 1.2344),
                Position(x: 0.00049, y: 0),
            ]
        ])

        #expect(
            try polygon.rounded() == .polygon([
                [
                    Position(x: 0, y: 0),
                    Position(x: 1.235, y: 0),
                    Position(x: 1.235, y: 1.234),
                    Position(x: 0, y: 0),
                ]
            ])
        )
    }

    @Test("Positions are returned in document order")
    func flattensPositions() {
        let multiPolygon = Geometry.multiPolygon([
            [[Position(x: 0, y: 0), Position(x: 1, y: 1)]],
            [[Position(x: 2, y: 2)]],
        ])

        #expect(multiPolygon.positions.map(\.x) == [0, 1, 2])
    }

    @Test("A geometry survives a GeoJSON round trip")
    func roundTripsThroughJSON() throws {
        let original = Geometry.lineString([Position(x: 1.5, y: -2.25), Position(x: 3, y: 4)])
        let data = try JSONEncoder().encode(original)

        #expect(try JSONDecoder().decode(Geometry.self, from: data) == original)
    }

    @Test("A three-ordinate position is rejected")
    func rejectsElevation() {
        let data = Data(#"{"type":"Point","coordinates":[1,2,3]}"#.utf8)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(Geometry.self, from: data)
        }
    }

    @Test("Local planar geometry is never labelled EPSG:4326")
    func localSpaceUsesUndefinedSrid() {
        #expect(CoordinateSpaceRegistration.srid(for: .localPlanarMetres) == 0)
        #expect(CoordinateSpaceRegistration.srid(for: .geographicWgs84) == 4326)
        #expect(CoordinateSpaceRegistration.isLocalPlanar(srid: 0))
        #expect(!CoordinateSpaceRegistration.isLocalPlanar(srid: 4326))
    }
}
