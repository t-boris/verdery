import CoreDesignSystem
import SwiftUI

/// The calibration session's control surface (P6-PLAN-02 iOS parity),
/// shown below the canvas while a session is active — the iOS counterpart
/// of the web's `CalibrationPanel`: step instruction, known-distance entry,
/// segment re-pick, control points with their live per-point residuals,
/// manual rotation (degrees), the honest quality line, and Apply/Cancel.
/// The canvas half of the session (tapping points, dragging the preview)
/// lives in the ordinary canvas gestures, routed by the view model.
struct MapCalibrationBarView: View {
    @Bindable var model: MapEditorViewModel

    /// Every fixed dimension in this bar scales with the reader's text size.
    ///
    /// The three literals these replace (120, 100, 220) were sized for the
    /// default text size only: at the accessibility sizes the two numeric
    /// fields clipped their own contents and the scrolling panel showed
    /// barely one row, which made the calibration flow — the one flow where a
    /// wrong number produces a wrong measurement — unusable for exactly the
    /// readers who enlarge text.
    @ScaledMetric(relativeTo: .body) private var distanceFieldWidth: CGFloat = 120
    @ScaledMetric(relativeTo: .body) private var rotationFieldWidth: CGFloat = 100
    @ScaledMetric(relativeTo: .body) private var sessionPanelHeight: CGFloat = 220

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let hint = model.calibrationHint {
                Text(hint)
                    .font(.footnote)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.yellow.opacity(0.2))
                    .accessibilityIdentifier("map.calibration.hint")
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    distanceField
                    segmentAndControlPointActions
                    controlPointList
                    rotationField
                    qualityLine
                }
                .padding(8)
            }
            .frame(maxHeight: sessionPanelHeight)

            HStack {
                Button(model.strings(.mapCalibrationApply)) {
                    Task { await model.applyCalibration() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.canApplyCalibration)
                .accessibilityIdentifier("map.calibration.apply")

                Spacer()

                Button(model.strings(.mapCalibrationCancel)) {
                    model.cancelCalibration()
                }
                .accessibilityIdentifier("map.calibration.cancel")
            }
            .padding(8)
        }
    }

    /// The known distance between two picked points — the number the whole
    /// calibration rests on. A nudgeable numeral rather than a bordered box:
    /// it is a measurement, it wants the reader's own decimal separator, and
    /// correcting it by a centimetre is a drag rather than a re-typing.
    /// Written back POSIX: this string is what the calibration command
    /// carries, and the model parses it with `Double(_:)`. A localized `12,5`
    /// would round-trip to nothing.
    private var distanceBinding: Binding<Double> {
        Binding(
            get: { Double(model.calibrationDistanceText) ?? 0 },
            set: { newValue in
                let rounded = (newValue * 100).rounded() / 100
                model.setCalibrationDistanceText(String(rounded))
            }
        )
    }

    private var rotationBinding: Binding<Double> {
        Binding(
            get: { Double(model.calibrationRotationDegreesText) ?? 0 },
            set: { newValue in
                model.setCalibrationRotationDegrees(String(Int(newValue.rounded())))
            }
        )
    }

    private var distanceField: some View {
        MeasureField(
            fieldName: model.strings(.mapCalibrationDistanceLabel),
            unitLabel: model.strings(.mapCalibrationDistanceUnit),
            decreaseLabel: model.strings(.mapCalibrationDistanceDecrease),
            increaseLabel: model.strings(.mapCalibrationDistanceIncrease),
            value: distanceBinding,
            step: 0.1,
            range: 0...10_000,
            fractionDigits: 2,
            locale: .autoupdatingCurrent
        )
        .accessibilityIdentifier("map.calibration.distance")
    }

    private var segmentAndControlPointActions: some View {
        HStack {
            Button(model.strings(.mapCalibrationRepickSegment)) {
                model.repickCalibrationSegment()
            }
            .accessibilityIdentifier("map.calibration.repickSegment")

            Button(model.strings(.mapCalibrationAddControlPoint)) {
                model.beginCalibrationControlPoint()
            }
            .disabled(!model.canAddCalibrationControlPoint)
            .accessibilityIdentifier("map.calibration.addControlPoint")
        }
        .buttonStyle(.bordered)
        .font(.callout)
    }

    @ViewBuilder
    private var controlPointList: some View {
        Text(model.strings(.mapCalibrationControlPointsTitle))
            .font(.caption)
            .foregroundStyle(.secondary)

        let rows = model.calibrationControlPointRows
        if rows.isEmpty {
            Text(model.strings(.mapCalibrationNoControlPoints))
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("map.calibration.noControlPoints")
        } else {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack {
                    Text(row).font(.callout)
                    Spacer()
                    Button(model.strings(.mapCalibrationRemovePoint)) {
                        model.removeCalibrationControlPoint(at: index)
                    }
                    .buttonStyle(.borderless)
                    .font(.callout)
                    .accessibilityIdentifier("map.calibration.removePoint")
                }
            }
        }
    }

    /// How far the drawing is turned. A dial, for the same reason the
    /// georeference screen's north is one: the question is spatial — "it sits
    /// like that" — and typing 37 into a box is the slowest way to answer it.
    private var rotationField: some View {
        CompassDial(
            fieldName: model.strings(.mapCalibrationRotationLabel),
            valueText: model.calibrationRotationDegreesText,
            degrees: rotationBinding
        )
        .disabled(!model.isCalibrationPreviewReady)
        .accessibilityIdentifier("map.calibration.rotation")
    }

    @ViewBuilder
    private var qualityLine: some View {
        if let quality = model.calibrationQualityText {
            Text(quality)
                .font(.footnote)
                .accessibilityIdentifier("map.calibration.quality")
        }
    }
}
