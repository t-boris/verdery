import Foundation
import Testing

@testable import CoreDomain

/// Cross-runtime equivalence gate for coordinate rounding.
///
/// The fixture declares exact comparison, so an off-by-one-ulp disagreement with
/// the TypeScript implementation is a hard failure rather than something to tune.
///
/// Source: architecture/testing-strategy.md, section "10. Geometry Equivalence".
@Suite("Coordinate rounding equivalence")
struct CoordinateRoundingEquivalenceTests {
    // Parameterized arguments must be available before any test runs, so a
    // missing or malformed fixture has to fail here rather than inside a case.
    static let fixture: RoundingFixture = try! GeometryFixtures.load("geometry/rounding.json")

    @Test("The fixture is the schema this port was written against")
    func schemaVersion() {
        #expect(Self.fixture.schemaVersion == 1)
        #expect(Self.fixture.comparison == "exact")
    }

    @Test("Rounds", arguments: fixture.cases)
    func rounds(_ testCase: RoundingFixture.Case) throws {
        #expect(try CoordinateRounding.round(testCase.input) == testCase.expected)
    }

    @Test("Rejects", arguments: fixture.rejectedCases)
    func rejects(_ testCase: RoundingFixture.RejectedCase) {
        let failure = #expect(throws: CoordinateRangeError.self) {
            try CoordinateRounding.round(testCase.input.value)
        }

        #expect(failure?.reason.rawValue == testCase.reason)
    }
}

@Suite("Coordinate rounding")
struct CoordinateRoundingTests {
    @Test("Rounding a rounded value changes nothing")
    func isIdempotent() throws {
        for value in [1.23456, -9.87654, 0.0005, -0.0015, 4999.9999] {
            let once = try CoordinateRounding.round(value)
            #expect(try CoordinateRounding.round(once) == once)
        }
    }

    @Test("Never returns negative zero")
    func normalizesNegativeZero() throws {
        let result = try CoordinateRounding.round(-0.0001)

        #expect(result == 0)
        #expect(result.sign == .plus)
    }

    @Test("Rounds both axes of a position")
    func roundsPosition() throws {
        let rounded = try CoordinateRounding.round(Position(x: 1.23449, y: -7.6544))

        #expect(rounded == Position(x: 1.234, y: -7.654))
    }

    @Test("Treats values on the same grid point as equal")
    func comparesOnTheGrid() throws {
        #expect(try CoordinateRounding.coordinatesEqual(1.2344, 1.23441))
        #expect(try !CoordinateRounding.coordinatesEqual(1.2344, 1.2351))
    }
}
