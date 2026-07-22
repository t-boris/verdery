import Testing

@testable import CoreDomain

/// Cross-runtime equivalence gate for deterministic local undo.
///
/// Every case in `command-inverse.json`, including the `nil`-expected
/// split/join/calibration/decideProposal cases, must produce the identical
/// result in Swift as `inverse-command.test.ts` asserts in TypeScript.
///
/// Source: architecture/testing-strategy.md, section "10. Geometry Equivalence";
/// architecture/map-rendering-and-editing.md, section "9. Undo and Redo".
@Suite("Deterministic local undo equivalence")
struct InverseCommandEquivalenceTests {
    // Parameterized arguments must be available before any test runs, so a
    // missing or malformed fixture has to fail here rather than inside a case.
    static let fixture: CommandInverseFixture =
        try! GeometryFixtures.load("geometry/command-inverse.json")

    @Test("The fixture is the schema this port was written against")
    func schemaVersion() {
        #expect(Self.fixture.schemaVersion == 1)
        #expect(Self.fixture.comparison == "exact")
    }

    @Test("Derives the inverse command", arguments: fixture.cases)
    func derivesInverse(_ testCase: CommandInverseFixture.Case) {
        let inverse = deriveInverseCommand(
            command: testCase.command,
            priorSnapshot: testCase.priorSnapshot,
            revisionAfterCommand: testCase.revisionAfterCommand
        )

        #expect(inverse == testCase.expectedInverse)
    }
}

/// Additional undo-stack invariants beyond the shared fixture, ported from
/// `inverse-command.test.ts`'s own non-fixture cases.
@Suite("Deterministic local undo")
struct InverseCommandTests {
    @Test("Applying the inverse of an inverse returns the original translation")
    func moveRoundTrips() {
        let command = MapCommandPayload.moveObject(
            MoveObjectPayload(
                objectId: "obj-1",
                expectedRevision: 1,
                translationMetres: PlanarOffset(dx: 3, dy: -2)
            )
        )

        let inverse = deriveInverseCommand(
            command: command, priorSnapshot: nil, revisionAfterCommand: 2
        )
        #expect(inverse != nil)

        let roundTrip = deriveInverseCommand(
            command: inverse!, priorSnapshot: nil, revisionAfterCommand: 3
        )

        #expect(
            roundTrip
                == .moveObject(
                    MoveObjectPayload(
                        objectId: "obj-1",
                        expectedRevision: 3,
                        translationMetres: PlanarOffset(dx: 3, dy: -2)
                    )
                )
        )
    }

    @Test("A vertex index absent from the prior geometry has no inverse")
    func editVertexMoveWithMissingVertexHasNoInverse() {
        let command = MapCommandPayload.editVertex(
            EditVertexPayload(
                objectId: "obj-1",
                expectedRevision: 1,
                operation: .move,
                ringIndex: 0,
                vertexIndex: 99,
                position: Position(x: 1, y: 1)
            )
        )
        let priorSnapshot = ObjectSnapshot(
            objectId: "obj-1",
            category: .zone,
            geometry: .point(Position(x: 0, y: 0)),
            lifecycleState: .active
        )

        #expect(
            deriveInverseCommand(
                command: command, priorSnapshot: priorSnapshot, revisionAfterCommand: 2
            ) == nil
        )
    }
}
