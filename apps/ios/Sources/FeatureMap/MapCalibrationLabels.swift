import CoreDomain
import CoreLocalization
import Foundation

/// The one place a background's calibration state/quality becomes user text
/// — the canvas badge, the background panel, the property sheet, and the
/// calibration bar all read it from here, so section 16's "displays
/// calibration quality and prevents false precision" has exactly one wording
/// to keep honest: an explicit ± estimate when one exists, an explicit
/// "accuracy not estimated" when it does not (below two control points),
/// never an implied zero. The Swift counterpart of the web's
/// `calibration-labels.ts`.
public enum MapCalibrationLabels {
    /// Honest error formatting: centimetres below a metre, metres above —
    /// never more digits than the estimate supports.
    ///
    /// Both the separator and the unit go through the catalogue. The previous
    /// `String(format: "%.1f cm", …)` put a POSIX decimal point and an
    /// English abbreviation inside otherwise-Russian prose ("погрешность
    /// ±1.5 cm"). The *digit counts* are unchanged, so this still renders the
    /// same figure as the web client for the same stored RMS — the parity
    /// that mattered was the precision, never the punctuation. The web's
    /// `calibration-labels.ts` carries the identical change.
    public static func formatErrorMetres(_ value: Double, strings: LocalizedStrings) -> String {
        value < 1
            ? strings.string(
                .mapUnitsCentimetres,
                parameters: ["value": strings.number(value * 100, fractionDigits: 1)]
            )
            : strings.string(
                .mapUnitsMetres,
                parameters: ["value": strings.number(value, fractionDigits: 2)]
            )
    }

    /// The state/quality text for a background, calibrated or not.
    public static func stateText(
        for calibration: ImportedBackgroundCalibration?,
        strings: LocalizedStrings
    ) -> String {
        guard let calibration else {
            return strings(.mapBackgroundNotCalibrated)
        }
        guard let rmsErrorMetres = calibration.rmsErrorMetres else {
            return strings(.mapBackgroundCalibratedNoEstimate)
        }
        return strings.string(
            .mapBackgroundCalibratedError,
            parameters: ["value": formatErrorMetres(rmsErrorMetres, strings: strings)]
        )
    }
}
