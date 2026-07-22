import Testing

@testable import CoreDomain

/// Cross-runtime equivalence gate for geometry validation.
///
/// Renderer-specific pixels may differ between clients; validation outcomes must
/// not. The fixture asserts the issue codes, because those are what a client
/// localizes and what the server rejects on.
///
/// Source: architecture/testing-strategy.md, section "10. Geometry Equivalence".
@Suite("Geometry validation equivalence")
struct GeometryValidationEquivalenceTests {
    // Parameterized arguments must be available before any test runs, so a
    // missing or malformed fixture has to fail here rather than inside a case.
    static let fixture: ValidationFixture = try! GeometryFixtures.load("geometry/validation.json")

    @Test("The fixture is the schema this port was written against")
    func schemaVersion() {
        #expect(Self.fixture.schemaVersion == 1)
    }

    @Test("Validates", arguments: fixture.cases)
    func validates(_ testCase: ValidationFixture.Case) {
        let issues = GeometryValidation.validate(testCase.geometry)

        #expect(issues.map(\.code) == testCase.expectedCodes)
    }

    @Test("A geometry is valid exactly when it has no issues", arguments: fixture.cases)
    func validityAgreesWithIssues(_ testCase: ValidationFixture.Case) {
        #expect(
            GeometryValidation.isValid(testCase.geometry) == testCase.expectedCodes.isEmpty
        )
    }
}

@Suite("Geometry validation codes")
struct GeometryValidationCodeTests {
    @Test("Every emitted code is listed in the catalogue")
    func catalogueIsComplete() {
        // The localization completeness test relies on this list, so a new code
        // that is not registered must fail here rather than silently ship
        // untranslated.
        #expect(Set(GeometryValidationCode.all).count == GeometryValidationCode.all.count)

        let emitted = GeometryValidationEquivalenceTests.fixture.cases
            .flatMap(\.expectedCodes)

        #expect(Set(emitted).isSubset(of: Set(GeometryValidationCode.all)))
    }
}
