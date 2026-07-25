/// The `importedBackground` category's detail payload (P6-PLAN-01/-02) —
/// the non-authoritative background asset a plan import produces.
///
/// Mirrors `packages/geometry-contracts/src/object-category.ts` one-to-one.
/// Every struct here codes by straight synthesis: its Swift property names
/// already match the JSON field names (the same rule as every other detail
/// struct in `GardenObjectDetails.swift`), so the flat wire coding
/// (`GardenObjectDetailsWireCoding`) and the nested local coding
/// (`GardenObjectDetailsCoding`) both reuse the synthesized conformances.
///
/// Source: architecture/map-rendering-and-editing.md, section "16. Plan
/// Import and Calibration"; packages/api-contracts/openapi.yaml,
/// `ImportedBackgroundDetails`/`ImportedBackgroundCalibration`.

/// `uncalibrated` (P6-PLAN-01) or `calibrated` (P6-PLAN-02). Deliberately no
/// intermediate or quality-graded state: quality is the continuous
/// `rmsErrorMetres` (including its honest absence below two control
/// points), not a threshold bucket. Server-owned — only the
/// `upsertCalibration` command changes it.
public enum ImportedBackgroundCalibrationState: String, Codable, Sendable, CaseIterable {
    case uncalibrated
    case calibrated
}

/// A control point echoed back with the residual the stored transform leaves at it.
public struct CalibratedReferencePoint: Equatable, Sendable, Codable {
    public let planPoint: Position
    public let localMetres: Position
    public let residualMetres: Double

    public init(planPoint: Position, localMetres: Position, residualMetres: Double) {
        self.planPoint = planPoint
        self.localMetres = localMetres
        self.residualMetres = residualMetres
    }
}

/// The server-owned calibration block a CALIBRATED background's details
/// carry: the full inputs (so recalibration can re-derive and re-display
/// them), the derived transform, and the honest error report. Never
/// client-writable — a `createObject`/`changeProperties` payload that
/// echoes it back is ignored server-side; only the `upsertCalibration`
/// command produces a new revision. `FeatureMap` strips it before
/// submitting a details replacement (`writableDetails`).
public struct ImportedBackgroundCalibration: Equatable, Sendable, Codable {
    /// Monotonically increasing per background, bumped by every
    /// recalibration — deliberately distinct from the object's own
    /// optimistic-concurrency revision, which bumps on EVERY edit.
    public let transformRevision: Int
    public let pageAspectRatio: Double
    public let knownDistance: PlanKnownDistance
    public let referencePoints: [CalibratedReferencePoint]
    public let manualAdjustment: ManualCalibrationAdjustment?
    public let transform: PlanTransform
    /// `nil` ("not expressed") below two control points — never a fabricated zero.
    public let rmsErrorMetres: Double?

    public init(
        transformRevision: Int,
        pageAspectRatio: Double,
        knownDistance: PlanKnownDistance,
        referencePoints: [CalibratedReferencePoint],
        manualAdjustment: ManualCalibrationAdjustment? = nil,
        transform: PlanTransform,
        rmsErrorMetres: Double?
    ) {
        self.transformRevision = transformRevision
        self.pageAspectRatio = pageAspectRatio
        self.knownDistance = knownDistance
        self.referencePoints = referencePoints
        self.manualAdjustment = manualAdjustment
        self.transform = transform
        self.rmsErrorMetres = rmsErrorMetres
    }
}

/// The non-authoritative background asset a plan import produces. An
/// UNcalibrated background's own Polygon geometry is only a placeholder
/// placement; a CALIBRATED background's geometry is the server-derived
/// page footprint of `calibration.transform`.
public struct ImportedBackgroundDetails: Equatable, Sendable, Codable {
    /// The `imported_plan` media record (the original document) this
    /// background displays. Must belong to the same garden — validated
    /// server-side.
    public let planMediaId: String
    /// 1-based page of a multi-page (PDF) source. `nil` — equivalent to 1 —
    /// for a raster plan. Pages above 1 are only accepted for a PDF source;
    /// PDF pages cannot render yet (P6-WORKER-02's documented deferral).
    public let sourcePageNumber: Int?
    /// Per-background persisted visibility — "independently hideable"
    /// (Phase 6 exit criterion), distinct from the client-local layer-2
    /// visibility preference.
    public let isBackgroundVisible: Bool
    public let calibrationState: ImportedBackgroundCalibrationState
    /// Present exactly when `calibrationState` is `.calibrated`. Server-owned.
    public let calibration: ImportedBackgroundCalibration?

    public init(
        planMediaId: String,
        sourcePageNumber: Int? = nil,
        isBackgroundVisible: Bool = true,
        calibrationState: ImportedBackgroundCalibrationState = .uncalibrated,
        calibration: ImportedBackgroundCalibration? = nil
    ) {
        self.planMediaId = planMediaId
        self.sourcePageNumber = sourcePageNumber
        self.isBackgroundVisible = isBackgroundVisible
        self.calibrationState = calibrationState
        self.calibration = calibration
    }

    /// A copy safe to submit in a `createObject`/`changeProperties` details
    /// payload: the server-owned `calibration` block stripped, everything
    /// client-writable kept — the Swift counterpart of the web's
    /// `writableImportedBackgroundDetails` (`features/map/commands.ts`).
    /// `calibrationState` is deliberately KEPT: `changeProperties` must echo
    /// the current stored state (the server rejects a mismatch).
    public var writableDetails: ImportedBackgroundDetails {
        ImportedBackgroundDetails(
            planMediaId: planMediaId,
            sourcePageNumber: sourcePageNumber,
            isBackgroundVisible: isBackgroundVisible,
            calibrationState: calibrationState,
            calibration: nil
        )
    }

    /// The same details with `isBackgroundVisible` replaced — the visibility
    /// toggle's one-field edit, already stripped to writable fields.
    public func withBackgroundVisible(_ isVisible: Bool) -> ImportedBackgroundDetails {
        ImportedBackgroundDetails(
            planMediaId: planMediaId,
            sourcePageNumber: sourcePageNumber,
            isBackgroundVisible: isVisible,
            calibrationState: calibrationState,
            calibration: nil
        )
    }
}
