import CoreDomain
import Foundation

/// What the next canvas tap means during a calibration session: the two
/// known-distance segment endpoints (plan points), a control point's plan
/// half, or its local (map) half. `none` — taps select nothing for the
/// session; the preview may be dragged instead.
public enum MapCalibrationCapture: Equatable, Sendable {
    case segment
    case controlPlan
    case controlLocal
    case none
}

/// An in-progress calibration session's draft — the client-side half of
/// section 16's flow: pick the known-distance segment on the plan, enter
/// the real distance, optionally pair control points, adjust placement
/// manually, apply. A value type mutated only through
/// ``MapCalibrationSession``'s pure transitions (the Swift port of the
/// web's `calibration-session.ts`), so the whole flow is unit-testable
/// without SwiftUI or a canvas. The live preview and the final command both
/// run the SAME shared derivation (``derivePlanCalibration``) the server
/// runs, so what the user previews is what the server stores.
public struct MapCalibrationDraft: Equatable, Sendable {
    public let objectId: String
    /// 0..2 plan-fraction points of the known-distance segment.
    public var segmentPoints: [Position]
    /// Raw text of the distance field — parsed on use, so partial typing never corrupts the draft.
    public var distanceText: String
    public var referencePoints: [CalibrationControlPoint]
    /// A tapped plan point awaiting its local-space pair.
    public var pendingPlanPoint: Position?
    public var manualAdjustment: ManualCalibrationAdjustment?
    public var capture: MapCalibrationCapture

    public init(
        objectId: String,
        segmentPoints: [Position] = [],
        distanceText: String = "",
        referencePoints: [CalibrationControlPoint] = [],
        pendingPlanPoint: Position? = nil,
        manualAdjustment: ManualCalibrationAdjustment? = nil,
        capture: MapCalibrationCapture = .segment
    ) {
        self.objectId = objectId
        self.segmentPoints = segmentPoints
        self.distanceText = distanceText
        self.referencePoints = referencePoints
        self.pendingPlanPoint = pendingPlanPoint
        self.manualAdjustment = manualAdjustment
        self.capture = capture
    }
}

/// The live preview: same math as the server, or an honest reason there is
/// nothing to preview yet.
public enum MapCalibrationPreview: Equatable, Sendable {
    case incomplete
    case invalid(code: String)
    case ready(PlanCalibrationDerivation)
}

/// Pure state transitions for ``MapCalibrationDraft`` — each mirrors the
/// same-named function in the web's `calibration-session.ts`.
public enum MapCalibrationSession {
    /// Fresh session, or one seeded from the stored inputs for
    /// recalibration — re-derivable, never a restart.
    public static func start(
        objectId: String,
        existing: ImportedBackgroundCalibration? = nil
    ) -> MapCalibrationDraft {
        guard let existing else {
            return MapCalibrationDraft(objectId: objectId)
        }
        return MapCalibrationDraft(
            objectId: objectId,
            segmentPoints: [existing.knownDistance.pointA, existing.knownDistance.pointB],
            distanceText: formatDistance(existing.knownDistance.distanceMetres),
            referencePoints: existing.referencePoints.map {
                CalibrationControlPoint(planPoint: $0.planPoint, localMetres: $0.localMetres)
            },
            manualAdjustment: existing.manualAdjustment,
            capture: .none
        )
    }

    public static func parsedDistanceMetres(_ draft: MapCalibrationDraft) -> Double? {
        let text = draft.distanceText.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let value = Double(text), value.isFinite, value > 0 else { return nil }
        return value
    }

    /// A plan-space tap while capturing. Ignored outside a plan-point capture mode.
    public static func withPlanPoint(_ draft: MapCalibrationDraft, planPoint: Position) -> MapCalibrationDraft {
        var next = draft
        switch draft.capture {
        case .segment:
            next.segmentPoints = Array((draft.segmentPoints + [planPoint]).prefix(2))
            next.capture = next.segmentPoints.count < 2 ? .segment : .none
        case .controlPlan:
            next.pendingPlanPoint = planPoint
            next.capture = .controlLocal
        case .controlLocal, .none:
            break
        }
        return next
    }

    /// A map (local-space) tap while a control point's plan half is pending.
    public static func withLocalPoint(_ draft: MapCalibrationDraft, localMetres: Position) -> MapCalibrationDraft {
        guard draft.capture == .controlLocal, let planPoint = draft.pendingPlanPoint else { return draft }
        var next = draft
        next.referencePoints.append(CalibrationControlPoint(planPoint: planPoint, localMetres: localMetres))
        next.pendingPlanPoint = nil
        next.capture = .none
        return next
    }

    public static func withDistanceText(_ draft: MapCalibrationDraft, distanceText: String) -> MapCalibrationDraft {
        var next = draft
        next.distanceText = distanceText
        return next
    }

    public static func restartSegment(_ draft: MapCalibrationDraft) -> MapCalibrationDraft {
        var next = draft
        next.segmentPoints = []
        next.capture = .segment
        next.pendingPlanPoint = nil
        return next
    }

    public static func beginControlPoint(_ draft: MapCalibrationDraft) -> MapCalibrationDraft {
        var next = draft
        next.capture = .controlPlan
        next.pendingPlanPoint = nil
        return next
    }

    public static func cancelCapture(_ draft: MapCalibrationDraft) -> MapCalibrationDraft {
        var next = draft
        next.capture = .none
        next.pendingPlanPoint = nil
        return next
    }

    public static func removeReferencePoint(_ draft: MapCalibrationDraft, at index: Int) -> MapCalibrationDraft {
        guard draft.referencePoints.indices.contains(index) else { return draft }
        var next = draft
        next.referencePoints.remove(at: index)
        return next
    }

    /// The complete derivation input, or `nil` while the segment or distance is still missing.
    public static func input(for draft: MapCalibrationDraft, pageAspectRatio: Double) -> PlanCalibrationInput? {
        guard draft.segmentPoints.count >= 2, let distanceMetres = parsedDistanceMetres(draft) else {
            return nil
        }
        return PlanCalibrationInput(
            pageAspectRatio: pageAspectRatio,
            knownDistance: PlanKnownDistance(
                pointA: draft.segmentPoints[0],
                pointB: draft.segmentPoints[1],
                distanceMetres: distanceMetres
            ),
            referencePoints: draft.referencePoints,
            manualAdjustment: draft.manualAdjustment
        )
    }

    public static func preview(for draft: MapCalibrationDraft, pageAspectRatio: Double) -> MapCalibrationPreview {
        guard let input = input(for: draft, pageAspectRatio: pageAspectRatio) else {
            return .incomplete
        }
        do {
            return .ready(try derivePlanCalibration(input))
        } catch let error as CalibrationInputError {
            return .invalid(code: error.code.rawValue)
        } catch let error as CoordinateRangeError {
            // A derived translation outside the representable local range —
            // the same "these inputs cannot produce a calibration" outcome
            // as a CalibrationInputError, surfaced under the range error's
            // own stable reason.
            return .invalid(code: error.reason.rawValue)
        } catch {
            return .invalid(code: "unexpected")
        }
    }

    /// The derivation WITHOUT the manual adjustment — the base
    /// `manualAdjustmentBetween` needs.
    private static func fittedTransform(
        for draft: MapCalibrationDraft,
        pageAspectRatio: Double
    ) -> PlanTransform? {
        guard var input = input(for: draft, pageAspectRatio: pageAspectRatio) else { return nil }
        input = PlanCalibrationInput(
            pageAspectRatio: input.pageAspectRatio,
            knownDistance: input.knownDistance,
            referencePoints: input.referencePoints,
            manualAdjustment: nil
        )
        return (try? derivePlanCalibration(input))?.transform
    }

    /// Drag gesture: shifts the preview by a local-space delta, recorded as
    /// manual-adjustment INPUT, never a raw transform overwrite.
    public static func withManualTranslation(
        _ draft: MapCalibrationDraft,
        dxMetres: Double,
        dyMetres: Double
    ) -> MapCalibrationDraft {
        let current = draft.manualAdjustment
            ?? ManualCalibrationAdjustment(rotationRadians: 0, translationMetres: PlanarOffset(dx: 0, dy: 0))
        var next = draft
        next.manualAdjustment = ManualCalibrationAdjustment(
            rotationRadians: current.rotationRadians,
            translationMetres: PlanarOffset(
                dx: current.translationMetres.dx + dxMetres,
                dy: current.translationMetres.dy + dyMetres
            )
        )
        return next
    }

    /// Orientation input: sets the manual rotation to `rotationRadians`,
    /// pivoting the preview about its own footprint center (rotating a plan
    /// about the distant local origin would fling it off screen). The
    /// stored manual rotation ends up exactly `rotationRadians`, so the
    /// bar's degrees field round-trips.
    public static func withManualRotation(
        _ draft: MapCalibrationDraft,
        pageAspectRatio: Double,
        rotationRadians: Double
    ) -> MapCalibrationDraft {
        guard case let .ready(derivation) = preview(for: draft, pageAspectRatio: pageAspectRatio),
            let fitted = fittedTransform(for: draft, pageAspectRatio: pageAspectRatio)
        else { return draft }

        let current = derivation.transform
        let currentManualRotation = draft.manualAdjustment?.rotationRadians ?? 0
        let delta = normalizeRotation(rotationRadians - currentManualRotation)
        let center = MapBackgroundPlacement.footprintCenter(
            planTransform: current, pageAspectRatio: pageAspectRatio
        )
        let desired = rotatePlanTransformAbout(current, pivot: center, deltaRadians: delta)

        var next = draft
        next.manualAdjustment = manualAdjustmentBetween(fitted: fitted, desired: desired)
        return next
    }

    /// With a known distance but no control points and no manual adjustment,
    /// the fit alone would drop the plan at the local origin — this seeds a
    /// manual translation that keeps the preview centered where the
    /// background already sat (its placeholder box), so the user adjusts
    /// from something visible instead of hunting for a teleported plan.
    public static func withSeededPlacement(
        _ draft: MapCalibrationDraft,
        pageAspectRatio: Double,
        targetCenter: Position
    ) -> MapCalibrationDraft {
        guard draft.manualAdjustment == nil, draft.referencePoints.isEmpty,
            let fitted = fittedTransform(for: draft, pageAspectRatio: pageAspectRatio)
        else { return draft }

        let fitCenter = MapBackgroundPlacement.footprintCenter(
            planTransform: fitted, pageAspectRatio: pageAspectRatio
        )
        var next = draft
        next.manualAdjustment = ManualCalibrationAdjustment(
            rotationRadians: 0,
            translationMetres: PlanarOffset(
                dx: targetCenter.x - fitCenter.x,
                dy: targetCenter.y - fitCenter.y
            )
        )
        return next
    }

    /// Renders a stored distance for the recalibration seed's text field the
    /// way the web's `String(number)` does — no trailing `.0` for a whole
    /// number, full precision otherwise.
    private static func formatDistance(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e15
            ? String(Int(value))
            : String(value)
    }
}
