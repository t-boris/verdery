/// The calibration bar's own measurement controls.
///
/// A separate enum because `LocalizationKey.swift` sits at exactly this
/// repository's 600-line ceiling, and an enum's cases cannot be declared in an
/// extension.
public enum MapCalibrationLocalizationKey: String, Sendable, CaseIterable {
    case mapCalibrationDistanceUnit = "map.calibration.distanceUnit"
    /// `MeasureField`'s two accessible adjust actions. A drag with no spoken
    /// equivalent is a control that does not exist for a VoiceOver reader.
    case mapCalibrationDistanceIncrease = "map.calibration.distanceIncrease"
    case mapCalibrationDistanceDecrease = "map.calibration.distanceDecrease"
}
