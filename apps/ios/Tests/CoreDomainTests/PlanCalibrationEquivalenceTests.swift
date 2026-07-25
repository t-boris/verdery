import Foundation
import Testing

@testable import CoreDomain

/// Cross-runtime equivalence gate for plan-background calibration.
///
/// Every case in the shared `geometry/calibration.json` — five success
/// cases (expected transform, per-point residuals, RMS, and page footprint)
/// and four rejected-input cases (expected issue codes) — must produce the
/// identical result in Swift as `calibration.test.ts` asserts in
/// TypeScript. The fixture is the reference: when a Swift result differs,
/// the Swift port is wrong.
///
/// Source: architecture/testing-strategy.md, section "10. Geometry
/// Equivalence"; architecture/map-rendering-and-editing.md, section
/// "16. Plan Import and Calibration".
struct CalibrationFixture: Decodable, Sendable {
    struct KnownDistance: Decodable, Sendable {
        let pointA: Position
        let pointB: Position
        let distanceMetres: Double
    }

    struct ControlPoint: Decodable, Sendable {
        let planPoint: Position
        let localMetres: Position
    }

    struct ManualAdjustment: Decodable, Sendable {
        struct Translation: Decodable, Sendable {
            let dx: Double
            let dy: Double
        }

        let rotationRadians: Double
        let translationMetres: Translation
    }

    struct Input: Decodable, Sendable {
        let pageAspectRatio: Double
        let knownDistance: KnownDistance
        let referencePoints: [ControlPoint]
        let manualAdjustment: ManualAdjustment?

        var domainValue: PlanCalibrationInput {
            PlanCalibrationInput(
                pageAspectRatio: pageAspectRatio,
                knownDistance: PlanKnownDistance(
                    pointA: knownDistance.pointA,
                    pointB: knownDistance.pointB,
                    distanceMetres: knownDistance.distanceMetres
                ),
                referencePoints: referencePoints.map {
                    CalibrationControlPoint(planPoint: $0.planPoint, localMetres: $0.localMetres)
                },
                manualAdjustment: manualAdjustment.map {
                    ManualCalibrationAdjustment(
                        rotationRadians: $0.rotationRadians,
                        translationMetres: PlanarOffset(
                            dx: $0.translationMetres.dx,
                            dy: $0.translationMetres.dy
                        )
                    )
                }
            )
        }
    }

    struct ExpectedTransform: Decodable, Sendable {
        struct Translation: Decodable, Sendable {
            let x: Double
            let y: Double
        }

        let metresPerPlanUnit: Double
        let rotationRadians: Double
        let translationMetres: Translation
    }

    struct Expected: Decodable, Sendable {
        let transform: ExpectedTransform
        let pointResidualsMetres: [Double]
        /// Explicit JSON `null` in the fixture decodes to `nil` — the
        /// "not expressed below two control points" contract.
        let rmsErrorMetres: Double?
        let footprint: [Position]
    }

    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let input: Input
        let expected: Expected

        var testDescription: String { name }
    }

    struct RejectedCase: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let input: Input
        let expectedCode: String

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let comparison: String
    let cases: [Case]
    let rejectedCases: [RejectedCase]
}

@Suite("Plan calibration equivalence")
struct PlanCalibrationEquivalenceTests {
    // Parameterized arguments must be available before any test runs, so a
    // missing or malformed fixture has to fail here rather than inside a
    // case — the same posture as `InverseCommandEquivalenceTests`.
    static let fixture: CalibrationFixture =
        try! GeometryFixtures.load("geometry/calibration.json")

    @Test("The fixture is the schema this port was written against")
    func schemaVersion() {
        #expect(Self.fixture.schemaVersion == 1)
        #expect(Self.fixture.comparison == "exact")
        #expect(Self.fixture.cases.count == 5)
        #expect(Self.fixture.rejectedCases.count == 4)
    }

    @Test("Derives the fixture's exact transform, residuals, and RMS", arguments: fixture.cases)
    func derivesExpectedDerivation(_ testCase: CalibrationFixture.Case) throws {
        let derivation = try derivePlanCalibration(testCase.input.domainValue)

        // Exact comparison, never an epsilon: the fixture numbers are the
        // deterministic rounding grid's own output.
        #expect(
            derivation.transform.metresPerPlanUnit == testCase.expected.transform.metresPerPlanUnit
        )
        #expect(derivation.transform.rotationRadians == testCase.expected.transform.rotationRadians)
        #expect(derivation.transform.translationMetres.x == testCase.expected.transform.translationMetres.x)
        #expect(derivation.transform.translationMetres.y == testCase.expected.transform.translationMetres.y)
        #expect(derivation.pointResidualsMetres == testCase.expected.pointResidualsMetres)
        #expect(derivation.rmsErrorMetres == testCase.expected.rmsErrorMetres)
    }

    @Test("Derives the fixture's exact page footprint", arguments: fixture.cases)
    func derivesExpectedFootprint(_ testCase: CalibrationFixture.Case) throws {
        let derivation = try derivePlanCalibration(testCase.input.domainValue)
        let footprint = try planPageFootprint(
            derivation.transform,
            pageAspectRatio: testCase.input.pageAspectRatio
        )

        #expect(footprint == .polygon([testCase.expected.footprint]))
    }

    @Test("Rejects each degenerate input with its exact issue code", arguments: fixture.rejectedCases)
    func rejectsWithExpectedCode(_ testCase: CalibrationFixture.RejectedCase) {
        #expect {
            _ = try derivePlanCalibration(testCase.input.domainValue)
        } throws: { error in
            guard let calibrationError = error as? CalibrationInputError else { return false }
            return calibrationError.code.rawValue == testCase.expectedCode
        }
    }
}

/// Helper invariants beyond the shared fixture, ported from
/// `calibration.test.ts`'s own non-fixture cases.
@Suite("Plan calibration helpers")
struct PlanCalibrationHelperTests {
    private let transform = PlanTransform(
        metresPerPlanUnit: 12,
        rotationRadians: 0.7,
        translationMetres: PlanTranslation(x: 4, y: -3)
    )

    @Test("applyPlanTransform and planPointForLocal are inverses")
    func transformRoundTrips() {
        let planPoint = Position(x: 0.31, y: 0.62)
        let local = applyPlanTransform(transform, to: planPoint)
        let roundTripped = planPointForLocal(transform, at: local)

        #expect(abs(roundTripped.x - planPoint.x) < 1e-12)
        #expect(abs(roundTripped.y - planPoint.y) < 1e-12)
    }

    @Test("translatePlanTransform shifts only the translation")
    func translateShiftsPlacement() {
        let moved = translatePlanTransform(transform, dxMetres: 2.5, dyMetres: -1)

        #expect(moved.metresPerPlanUnit == transform.metresPerPlanUnit)
        #expect(moved.rotationRadians == transform.rotationRadians)
        #expect(moved.translationMetres == PlanTranslation(x: 6.5, y: -4))
    }

    @Test("rotatePlanTransformAbout keeps the pivot fixed")
    func rotationKeepsPivotFixed() {
        let pivot = Position(x: 10, y: 5)
        let planPointAtPivot = planPointForLocal(transform, at: pivot)
        let rotated = rotatePlanTransformAbout(transform, pivot: pivot, deltaRadians: 0.5)
        let pivotAfter = applyPlanTransform(rotated, to: planPointAtPivot)

        #expect(abs(pivotAfter.x - pivot.x) < 1e-9)
        #expect(abs(pivotAfter.y - pivot.y) < 1e-9)
        #expect(abs(normalizeRotation(rotated.rotationRadians - transform.rotationRadians) - 0.5) < 1e-12)
    }

    @Test("manualAdjustmentBetween recovers the adjustment that maps fitted to desired")
    func manualAdjustmentBetweenRecovers() {
        let desired = rotatePlanTransformAbout(
            translatePlanTransform(transform, dxMetres: 3, dyMetres: 7),
            pivot: Position(x: 1, y: 2),
            deltaRadians: 0.25
        )
        let adjustment = manualAdjustmentBetween(fitted: transform, desired: desired)

        // Re-composing the recovered adjustment onto the fitted transform
        // (rotate about the origin, then translate) must land on `desired`.
        let cosine = cos(adjustment.rotationRadians)
        let sine = sin(adjustment.rotationRadians)
        let recomposedX =
            transform.translationMetres.x * cosine - transform.translationMetres.y * sine
            + adjustment.translationMetres.dx
        let recomposedY =
            transform.translationMetres.x * sine + transform.translationMetres.y * cosine
            + adjustment.translationMetres.dy

        #expect(abs(recomposedX - desired.translationMetres.x) < 1e-9)
        #expect(abs(recomposedY - desired.translationMetres.y) < 1e-9)
        #expect(
            abs(
                normalizeRotation(
                    transform.rotationRadians + adjustment.rotationRadians
                        - desired.rotationRadians
                )
            ) < 1e-12
        )
    }

    @Test("normalizeRotation lands in (-pi, pi] and never returns negative zero")
    func normalizeRotationRange() {
        #expect(normalizeRotation(3 * .pi) == .pi)
        #expect(normalizeRotation(-.pi) == .pi)
        #expect(normalizeRotation(0) == 0)
        #expect((normalizeRotation(-2 * .pi)).sign == .plus)
        #expect(abs(normalizeRotation(2 * .pi + 0.1) - 0.1) < 1e-12)
    }
}
