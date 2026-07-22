/// Measurements and their uncertainty.
///
/// The schema must not imply survey accuracy merely because a value uses a
/// precise numeric type — every measurement therefore carries how it was
/// acquired, so a UI can present "user-entered" and "AR-measured" distances
/// differently even though both are stored as the same SI number.
///
/// Source: architecture/data-and-geospatial-design.md, section
/// "11. Measurements and Uncertainty"; packages/geometry-contracts/src/measurement.ts.

public enum MeasurementUnit: String, Codable, Sendable, CaseIterable {
    case metres
    case squareMetres
    case degrees
}

public enum MeasurementAcquisitionMethod: String, Codable, Sendable, CaseIterable {
    case userEntered
    case derivedFromGeometry
    case arMeasurement
    case imageExtraction
    case depthCapture
    case importedPlan
}

public struct Measurement: Equatable, Sendable, Codable {
    /// Canonical SI value — metres, square metres, or degrees per ``MeasurementUnit``.
    public let value: Double
    public let unit: MeasurementUnit
    public let acquisitionMethod: MeasurementAcquisitionMethod
    /// As the user typed it, before conversion to the canonical unit — e.g. "40 ft".
    /// Absent when the value was derived, not entered.
    public let originalEntry: String?
    /// Absolute uncertainty in the same unit as ``value``. Absent means "not expressed", not "exact".
    public let uncertainty: Double?
    /// The object or segment this measurement is relative to, when it is not a standalone entry.
    public let referenceObjectId: String?
    /// The calibration revision this measurement was computed under, when derived
    /// from an imported, calibrated plan.
    public let calibrationRevision: Int?

    public init(
        value: Double,
        unit: MeasurementUnit,
        acquisitionMethod: MeasurementAcquisitionMethod,
        originalEntry: String? = nil,
        uncertainty: Double? = nil,
        referenceObjectId: String? = nil,
        calibrationRevision: Int? = nil
    ) {
        self.value = value
        self.unit = unit
        self.acquisitionMethod = acquisitionMethod
        self.originalEntry = originalEntry
        self.uncertainty = uncertainty
        self.referenceObjectId = referenceObjectId
        self.calibrationRevision = calibrationRevision
    }
}
