import CoreDomain
import Testing

@testable import FeatureMap

/// The pure calibration-session transitions — the Swift port of the web's
/// `calibration-session.ts`, exercised the same way its own test file
/// exercises the TypeScript original.
@Suite("Calibration session transitions")
struct MapCalibrationSessionTests {
    private let aspect = 0.75

    private func readyDraft() -> MapCalibrationDraft {
        var draft = MapCalibrationSession.start(objectId: "bg-1")
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.1, y: 0.1))
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.6, y: 0.1))
        draft = MapCalibrationSession.withDistanceText(draft, distanceText: "10")
        return draft
    }

    @Test("A fresh session starts capturing the segment")
    func freshSessionCapturesSegment() {
        let draft = MapCalibrationSession.start(objectId: "bg-1")

        #expect(draft.capture == .segment)
        #expect(draft.segmentPoints.isEmpty)
        #expect(draft.referencePoints.isEmpty)
        #expect(draft.manualAdjustment == nil)
    }

    @Test("Recalibration seeds the session from the stored inputs, not a restart")
    func recalibrationSeedsFromStoredInputs() {
        let existing = ImportedBackgroundCalibration(
            transformRevision: 2,
            pageAspectRatio: aspect,
            knownDistance: PlanKnownDistance(
                pointA: Position(x: 0.1, y: 0.1),
                pointB: Position(x: 0.6, y: 0.1),
                distanceMetres: 10
            ),
            referencePoints: [
                CalibratedReferencePoint(
                    planPoint: Position(x: 0.5, y: 0.25),
                    localMetres: Position(x: 10, y: 10),
                    residualMetres: 0
                )
            ],
            manualAdjustment: ManualCalibrationAdjustment(
                rotationRadians: 0.1,
                translationMetres: PlanarOffset(dx: 1, dy: 2)
            ),
            transform: PlanTransform(
                metresPerPlanUnit: 20,
                rotationRadians: 0,
                translationMetres: PlanTranslation(x: 0, y: 0)
            ),
            rmsErrorMetres: nil
        )

        let draft = MapCalibrationSession.start(objectId: "bg-1", existing: existing)

        #expect(draft.capture == .none)
        #expect(draft.segmentPoints == [Position(x: 0.1, y: 0.1), Position(x: 0.6, y: 0.1)])
        #expect(draft.distanceText == "10")
        #expect(draft.referencePoints.count == 1)
        #expect(draft.manualAdjustment?.translationMetres == PlanarOffset(dx: 1, dy: 2))
    }

    @Test("Two segment taps complete the segment and stop capturing")
    func segmentTapsComplete() {
        var draft = MapCalibrationSession.start(objectId: "bg-1")
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0, y: 0))
        #expect(draft.capture == .segment)

        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.5, y: 0))
        #expect(draft.capture == .none)
        #expect(draft.segmentPoints.count == 2)

        // A further plan tap outside any capture mode is ignored.
        let unchanged = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.9, y: 0))
        #expect(unchanged == draft)
    }

    @Test("A control point pairs a plan tap with a map tap")
    func controlPointPairsPlanAndLocal() {
        var draft = readyDraft()
        draft = MapCalibrationSession.beginControlPoint(draft)
        #expect(draft.capture == .controlPlan)

        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.5, y: 0.25))
        #expect(draft.capture == .controlLocal)
        #expect(draft.pendingPlanPoint == Position(x: 0.5, y: 0.25))

        draft = MapCalibrationSession.withLocalPoint(draft, localMetres: Position(x: 10, y: 10))
        #expect(draft.capture == .none)
        #expect(draft.pendingPlanPoint == nil)
        #expect(
            draft.referencePoints == [
                CalibrationControlPoint(
                    planPoint: Position(x: 0.5, y: 0.25), localMetres: Position(x: 10, y: 10)
                )
            ]
        )
    }

    @Test("The distance parses with a comma decimal separator and rejects junk")
    func distanceParsing() {
        var draft = MapCalibrationSession.start(objectId: "bg-1")
        draft = MapCalibrationSession.withDistanceText(draft, distanceText: " 12,5 ")
        #expect(MapCalibrationSession.parsedDistanceMetres(draft) == 12.5)

        draft = MapCalibrationSession.withDistanceText(draft, distanceText: "zero")
        #expect(MapCalibrationSession.parsedDistanceMetres(draft) == nil)

        draft = MapCalibrationSession.withDistanceText(draft, distanceText: "-4")
        #expect(MapCalibrationSession.parsedDistanceMetres(draft) == nil)
    }

    @Test("The preview is honest about being incomplete, invalid, or ready")
    func previewStates() {
        var draft = MapCalibrationSession.start(objectId: "bg-1")
        #expect(MapCalibrationSession.preview(for: draft, pageAspectRatio: aspect) == .incomplete)

        draft = readyDraft()
        guard case let .ready(derivation) = MapCalibrationSession.preview(for: draft, pageAspectRatio: aspect)
        else {
            Issue.record("Expected a ready preview")
            return
        }
        // The shared fixture's own first case: 0.5 plan units = 10 m.
        #expect(derivation.transform.metresPerPlanUnit == 20)
        #expect(derivation.rmsErrorMetres == nil)

        // Coincident segment points cannot derive a scale.
        var degenerate = MapCalibrationSession.start(objectId: "bg-1")
        degenerate = MapCalibrationSession.withPlanPoint(degenerate, planPoint: Position(x: 0.5, y: 0.5))
        degenerate = MapCalibrationSession.withPlanPoint(degenerate, planPoint: Position(x: 0.5, y: 0.5))
        degenerate = MapCalibrationSession.withDistanceText(degenerate, distanceText: "10")
        #expect(
            MapCalibrationSession.preview(for: degenerate, pageAspectRatio: aspect)
                == .invalid(code: "known_distance_segment_degenerate")
        )
    }

    @Test("Manual translations accumulate as re-derivable input")
    func manualTranslationAccumulates() {
        var draft = readyDraft()
        draft = MapCalibrationSession.withManualTranslation(draft, dxMetres: 2, dyMetres: -1)
        draft = MapCalibrationSession.withManualTranslation(draft, dxMetres: 0.5, dyMetres: 1)

        #expect(draft.manualAdjustment?.translationMetres == PlanarOffset(dx: 2.5, dy: 0))
        #expect(draft.manualAdjustment?.rotationRadians == 0)
    }

    @Test("The rotation field round-trips: the stored manual rotation is exactly what was set")
    func manualRotationRoundTrips() {
        var draft = readyDraft()
        draft = MapCalibrationSession.withManualTranslation(draft, dxMetres: 5, dyMetres: 5)
        draft = MapCalibrationSession.withManualRotation(
            draft, pageAspectRatio: aspect, rotationRadians: 0.3
        )

        let stored = draft.manualAdjustment?.rotationRadians ?? 0
        #expect(abs(stored - 0.3) < 1e-9)

        // The preview's rotation follows, and its footprint center stays
        // pinned (the pivot is the footprint's own center).
        guard case let .ready(derivation) = MapCalibrationSession.preview(for: draft, pageAspectRatio: aspect)
        else {
            Issue.record("Expected a ready preview")
            return
        }
        #expect(abs(derivation.transform.rotationRadians - 0.3) < 1e-6)
    }

    @Test("Seeded placement centers the preview on the target instead of the origin")
    func seededPlacementCenters() {
        var draft = readyDraft()
        draft = MapCalibrationSession.withSeededPlacement(
            draft, pageAspectRatio: aspect, targetCenter: Position(x: 30, y: 40)
        )

        guard case let .ready(derivation) = MapCalibrationSession.preview(for: draft, pageAspectRatio: aspect)
        else {
            Issue.record("Expected a ready preview")
            return
        }
        let center = MapBackgroundPlacement.footprintCenter(
            planTransform: derivation.transform, pageAspectRatio: aspect
        )
        #expect(abs(center.x - 30) < 1e-6)
        #expect(abs(center.y - 40) < 1e-6)
    }

    @Test("Seeding never overrides an existing adjustment or a control-point fit")
    func seedingIsConservative() {
        var adjusted = readyDraft()
        adjusted = MapCalibrationSession.withManualTranslation(adjusted, dxMetres: 1, dyMetres: 1)
        let seededAdjusted = MapCalibrationSession.withSeededPlacement(
            adjusted, pageAspectRatio: aspect, targetCenter: Position(x: 30, y: 40)
        )
        #expect(seededAdjusted == adjusted)

        var pinned = readyDraft()
        pinned = MapCalibrationSession.beginControlPoint(pinned)
        pinned = MapCalibrationSession.withPlanPoint(pinned, planPoint: Position(x: 0.5, y: 0.25))
        pinned = MapCalibrationSession.withLocalPoint(pinned, localMetres: Position(x: 10, y: 10))
        let seededPinned = MapCalibrationSession.withSeededPlacement(
            pinned, pageAspectRatio: aspect, targetCenter: Position(x: 30, y: 40)
        )
        #expect(seededPinned == pinned)
    }

    @Test("Removing a control point drops exactly that point")
    func removeControlPoint() {
        var draft = readyDraft()
        draft = MapCalibrationSession.beginControlPoint(draft)
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.2, y: 0.2))
        draft = MapCalibrationSession.withLocalPoint(draft, localMetres: Position(x: 1, y: 1))
        draft = MapCalibrationSession.beginControlPoint(draft)
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.4, y: 0.4))
        draft = MapCalibrationSession.withLocalPoint(draft, localMetres: Position(x: 2, y: 2))

        let removed = MapCalibrationSession.removeReferencePoint(draft, at: 0)
        #expect(removed.referencePoints.map(\.localMetres) == [Position(x: 2, y: 2)])

        // An out-of-range removal is a no-op, never a crash.
        #expect(MapCalibrationSession.removeReferencePoint(removed, at: 5) == removed)
    }
}
