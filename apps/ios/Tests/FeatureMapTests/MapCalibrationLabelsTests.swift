import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

/// P6-QA-01's plan-accuracy-label evidence for iOS: `MapCalibrationLabels`
/// is the one place a background's calibration state/quality becomes user
/// text, and until this suite nothing tested it — the shared fixtures pin
/// the MATH (RMS null below two control points) but not the words a null or
/// a number turns into. Boundary values mirror the web's own
/// `formatErrorMetres` test exactly, so the two clients are pinned to the
/// identical rendering for the same stored RMS.
@Suite("Calibration state and quality labels")
struct MapCalibrationLabelsTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func calibration(rmsErrorMetres: Double?) -> ImportedBackgroundCalibration {
        ImportedBackgroundCalibration(
            transformRevision: 1,
            pageAspectRatio: 0.75,
            knownDistance: PlanKnownDistance(
                pointA: Position(x: 0.1, y: 0.1),
                pointB: Position(x: 0.6, y: 0.1),
                distanceMetres: 10
            ),
            referencePoints: [],
            manualAdjustment: nil,
            transform: PlanTransform(
                metresPerPlanUnit: 20,
                rotationRadians: 0,
                translationMetres: PlanTranslation(x: 0, y: 0)
            ),
            rmsErrorMetres: rmsErrorMetres
        )
    }

    @Test("No calibration reads as the honest 'Not calibrated'")
    func uncalibratedState() {
        #expect(MapCalibrationLabels.stateText(for: nil, strings: strings) == "Not calibrated")
    }

    @Test("A null RMS states the absence of an estimate instead of implying zero")
    func nullRmsStatesNoEstimate() {
        let text = MapCalibrationLabels.stateText(
            for: calibration(rmsErrorMetres: nil),
            strings: strings
        )
        #expect(text == "Calibrated · accuracy not estimated")
    }

    @Test("A real RMS becomes the honest ± label with the formatted figure")
    func numericRmsBecomesErrorLabel() {
        let text = MapCalibrationLabels.stateText(
            for: calibration(rmsErrorMetres: 0.12),
            strings: strings
        )
        #expect(text == "Calibrated · ±12.0 cm estimated error")
    }

    @Test("Error formatting matches the web client value for value: centimetres below a metre, metres at and above")
    func formatErrorMetresParity() {
        // The identical inputs/outputs the web's calibration-panel test pins.
        #expect(MapCalibrationLabels.formatErrorMetres(0.12) == "12.0 cm")
        #expect(MapCalibrationLabels.formatErrorMetres(1.246) == "1.25 m")
        #expect(MapCalibrationLabels.formatErrorMetres(1) == "1.00 m")
        #expect(MapCalibrationLabels.formatErrorMetres(0.999) == "99.9 cm")
    }
}
