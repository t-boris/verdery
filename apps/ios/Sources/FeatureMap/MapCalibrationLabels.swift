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
    /// never more digits than the estimate supports. `String(format:)` uses
    /// the POSIX decimal separator regardless of the reader's locale, the
    /// same fixed formatting the web's `toFixed` produces, so the two
    /// clients render the identical figure for the same stored RMS.
    public static func formatErrorMetres(_ value: Double) -> String {
        value < 1
            ? String(format: "%.1f cm", value * 100)
            : String(format: "%.2f m", value)
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
            parameters: ["value": formatErrorMetres(rmsErrorMetres)]
        )
    }
}
