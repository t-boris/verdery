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
            .frame(maxHeight: 220)

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

    private var distanceField: some View {
        HStack {
            Text(model.strings(.mapCalibrationDistanceLabel))
                .font(.callout)
            TextField(
                model.strings(.mapCalibrationDistanceLabel),
                text: Binding(
                    get: { model.calibrationDistanceText },
                    set: { model.setCalibrationDistanceText($0) }
                )
            )
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 120)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
            .accessibilityIdentifier("map.calibration.distance")
        }
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

    private var rotationField: some View {
        HStack {
            Text(model.strings(.mapCalibrationRotationLabel))
                .font(.callout)
            TextField(
                model.strings(.mapCalibrationRotationLabel),
                text: Binding(
                    get: { model.calibrationRotationDegreesText },
                    set: { model.setCalibrationRotationDegrees($0) }
                )
            )
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 100)
            #if os(iOS)
                .keyboardType(.numbersAndPunctuation)
            #endif
            .disabled(!model.isCalibrationPreviewReady)
            .accessibilityIdentifier("map.calibration.rotation")
        }
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
