import Foundation

/// Plan-background calibration: the plan-space -> local-space transform an
/// imported background acquires when the user calibrates it, and the math
/// that derives it from calibration inputs.
///
/// A line-for-line Swift port of `packages/geometry-contracts/src/
/// calibration.ts` — the TypeScript module is the reference; the shared
/// fixtures in `packages/test-fixtures/fixtures/geometry/calibration.json`
/// are what pin the two implementations to byte-identical output (see
/// `Tests/CoreDomainTests/PlanCalibrationEquivalenceTests.swift`), exactly
/// the way `CoordinateRounding`/`CurveDensification` are already pinned.
///
/// Coordinate conventions
/// ----------------------
/// Plan space is measured in "plan-fraction" units: a plan point is
/// `(u, v)` where `u = xPixels / imageWidthPixels` and
/// `v = yPixels / imageWidthPixels` of whichever raster rendition of the
/// page the client displayed. Both axes divide by the WIDTH, so the unit is
/// isotropic and the representation is resolution-independent. `u` runs
/// 0..1 left to right; `v` runs 0..`pageAspectRatio` top to bottom (image
/// convention, y down). The transform is a SIMILARITY transform — uniform
/// scale, rotation, translation — never a 6-DOF affine, which would absorb
/// input noise into fabricated precision ("prevents false precision",
/// map-rendering-and-editing.md section 16).
///
/// Applying the transform converts image y-down to local y-up once, here:
///
///   local = translationMetres + metresPerPlanUnit * R(rotationRadians) * (u, -v)
///
/// The input types (``PlanKnownDistance``, ``CalibrationControlPoint``,
/// ``ManualCalibrationAdjustment``) live in `Map/MapCommandPayloads.swift` —
/// they are also the `upsertCalibration` command's own payload fields, the
/// same dual role they play in the TypeScript module.
///
/// Source: architecture/map-rendering-and-editing.md, section "16. Plan
/// Import and Calibration"; ADR-0010; packages/geometry-contracts/src/calibration.ts.

/// The derived plan-space -> local-space similarity transform. See the module doc comment for the exact formula.
public struct PlanTransform: Equatable, Sendable, Codable {
    /// Metres per plan-fraction unit, i.e. the page's full width in metres. Always > 0.
    public let metresPerPlanUnit: Double
    /// Counter-clockwise rotation in local space, normalized to (-pi, pi].
    public let rotationRadians: Double
    public let translationMetres: PlanTranslation

    public init(metresPerPlanUnit: Double, rotationRadians: Double, translationMetres: PlanTranslation) {
        self.metresPerPlanUnit = metresPerPlanUnit
        self.rotationRadians = rotationRadians
        self.translationMetres = translationMetres
    }
}

/// The transform's `{x, y}` translation in metres — an anonymous object type
/// in TypeScript, named here because Swift has no anonymous struct literal
/// (the same reason ``PlanarOffset`` exists for `{dx, dy}`).
public struct PlanTranslation: Equatable, Sendable, Codable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct PlanCalibrationInput: Equatable, Sendable {
    /// Page height / page width. Bounds `v` and shapes the page footprint.
    public let pageAspectRatio: Double
    public let knownDistance: PlanKnownDistance
    public let referencePoints: [CalibrationControlPoint]
    public let manualAdjustment: ManualCalibrationAdjustment?

    public init(
        pageAspectRatio: Double,
        knownDistance: PlanKnownDistance,
        referencePoints: [CalibrationControlPoint],
        manualAdjustment: ManualCalibrationAdjustment? = nil
    ) {
        self.pageAspectRatio = pageAspectRatio
        self.knownDistance = knownDistance
        self.referencePoints = referencePoints
        self.manualAdjustment = manualAdjustment
    }
}

public struct PlanCalibrationDerivation: Equatable, Sendable {
    public let transform: PlanTransform
    /// One residual per control point, in input order, metres.
    public let pointResidualsMetres: [Double]
    /// `nil` ("not expressed") below two control points — see the module doc comment.
    public let rmsErrorMetres: Double?

    public init(transform: PlanTransform, pointResidualsMetres: [Double], rmsErrorMetres: Double?) {
        self.transform = transform
        self.pointResidualsMetres = pointResidualsMetres
        self.rmsErrorMetres = rmsErrorMetres
    }
}

/// Raw values are the TypeScript union's own string literals — the shared
/// fixtures' `expectedCode` values compare against these directly.
public enum CalibrationInputIssueCode: String, Sendable, Codable, CaseIterable {
    case pageAspectRatioInvalid = "page_aspect_ratio_invalid"
    case knownDistanceNotPositive = "known_distance_not_positive"
    case knownDistanceSegmentDegenerate = "known_distance_segment_degenerate"
    case planPointOutsidePage = "plan_point_outside_page"
    case localPointOutOfRange = "local_point_out_of_range"
    case controlPointsTooMany = "control_points_too_many"
    case manualAdjustmentInvalid = "manual_adjustment_invalid"
}

/// Raised when calibration inputs cannot produce an honest transform.
/// `pointer` is relative to the input root.
public struct CalibrationInputError: Error, Equatable, Sendable, CustomStringConvertible {
    public let code: CalibrationInputIssueCode
    public let pointer: String
    public let message: String

    public init(code: CalibrationInputIssueCode, pointer: String, message: String) {
        self.code = code
        self.pointer = pointer
        self.message = message
    }

    public var description: String { message }
}

public enum PlanCalibrationLimits {
    /// Plausibility bound for a page's height/width ratio — a real property plan is never a 64:1 strip.
    public static let maximumPageAspectRatio = 64.0
    /// Shortest usable known-distance segment, in plan-fraction units (0.1% of the page width).
    public static let minimumKnownDistanceSegmentPlanUnits = 0.001
    /// More control points than this stops improving a 4-DOF fit and starts looking like an import, not a calibration.
    public static let maximumControlPointCount = 32
}

/// Rounding grids for derived values — fixed so shared fixtures compare
/// exactly across runtimes (ADR-0010's reasoning).
private let scaleDecimals = 6
private let rotationDecimals = 9
private let residualDecimals = 4

/// The exact IEEE 754 counterpart of the TypeScript module's own `roundTo`
/// (`Math.sign(scaled) * Math.round(Math.abs(scaled))`) — see
/// `CoordinateRounding.round`'s identical reasoning for
/// `.toNearestOrAwayFromZero`.
private func roundTo(_ value: Double, decimals: Int) -> Double {
    let scale = pow(10.0, Double(decimals))
    let rounded = (value * scale).rounded(.toNearestOrAwayFromZero) / scale
    return rounded == 0 ? 0 : rounded
}

/// Normalizes an angle to (-pi, pi].
public func normalizeRotation(_ radians: Double) -> Double {
    let twoPi = 2 * Double.pi
    var value = radians.truncatingRemainder(dividingBy: twoPi)
    if value <= -Double.pi {
        value += twoPi
    } else if value > Double.pi {
        value -= twoPi
    }
    return value == 0 ? 0 : value
}

/// Maps a plan-fraction point into local metres through `transform`.
public func applyPlanTransform(_ transform: PlanTransform, to planPoint: Position) -> Position {
    let cosine = cos(transform.rotationRadians)
    let sine = sin(transform.rotationRadians)
    let s = transform.metresPerPlanUnit
    // R(theta) applied to the y-flipped plan vector (u, -v).
    return Position(
        x: transform.translationMetres.x + s * (planPoint.x * cosine + planPoint.y * sine),
        y: transform.translationMetres.y + s * (planPoint.x * sine - planPoint.y * cosine)
    )
}

/// Inverse of ``applyPlanTransform(_:to:)``: which plan-fraction point sits at `localPoint`.
public func planPointForLocal(_ transform: PlanTransform, at localPoint: Position) -> Position {
    let cosine = cos(transform.rotationRadians)
    let sine = sin(transform.rotationRadians)
    let s = transform.metresPerPlanUnit
    let dx = localPoint.x - transform.translationMetres.x
    let dy = localPoint.y - transform.translationMetres.y
    // R(-theta) * d / s gives the y-flipped plan vector (u, -v).
    let u = (dx * cosine + dy * sine) / s
    let flippedV = (-dx * sine + dy * cosine) / s
    return Position(x: u, y: -flippedV)
}

/// Translates a transform's placement by a local-space delta.
public func translatePlanTransform(_ transform: PlanTransform, dxMetres: Double, dyMetres: Double) -> PlanTransform {
    PlanTransform(
        metresPerPlanUnit: transform.metresPerPlanUnit,
        rotationRadians: transform.rotationRadians,
        translationMetres: PlanTranslation(
            x: transform.translationMetres.x + dxMetres,
            y: transform.translationMetres.y + dyMetres
        )
    )
}

/// Rotates a transform's placement by `deltaRadians` about a local-space pivot (e.g. the footprint's center).
public func rotatePlanTransformAbout(
    _ transform: PlanTransform,
    pivot: Position,
    deltaRadians: Double
) -> PlanTransform {
    let cosine = cos(deltaRadians)
    let sine = sin(deltaRadians)
    let dx = transform.translationMetres.x - pivot.x
    let dy = transform.translationMetres.y - pivot.y
    return PlanTransform(
        metresPerPlanUnit: transform.metresPerPlanUnit,
        rotationRadians: normalizeRotation(transform.rotationRadians + deltaRadians),
        translationMetres: PlanTranslation(
            x: pivot.x + dx * cosine - dy * sine,
            y: pivot.y + dx * sine + dy * cosine
        )
    )
}

/// The manual adjustment that turns `fitted` into `desired` (same scale
/// assumed — a manual adjustment never rescales). This is how a client
/// records "the user dragged/rotated the preview to HERE" as re-derivable
/// input rather than a raw transform overwrite.
public func manualAdjustmentBetween(
    fitted: PlanTransform,
    desired: PlanTransform
) -> ManualCalibrationAdjustment {
    let rotation = normalizeRotation(desired.rotationRadians - fitted.rotationRadians)
    let cosine = cos(rotation)
    let sine = sin(rotation)
    return ManualCalibrationAdjustment(
        rotationRadians: rotation,
        translationMetres: PlanarOffset(
            dx: desired.translationMetres.x
                - (fitted.translationMetres.x * cosine - fitted.translationMetres.y * sine),
            dy: desired.translationMetres.y
                - (fitted.translationMetres.x * sine + fitted.translationMetres.y * cosine)
        )
    )
}

/// The page rectangle `[0,1] x [0,aspect]` mapped through `transform` as a
/// closed, counter-clockwise local-space Polygon, rounded to the storage
/// grid — the honest footprint geometry a calibrated background object
/// carries instead of its placeholder square.
///
/// - Throws: ``CoordinateRangeError`` when a transformed corner leaves the
///   representable local range — the same behavior as the TypeScript
///   module's `roundPosition`.
public func planPageFootprint(_ transform: PlanTransform, pageAspectRatio: Double) throws -> Geometry {
    // Bottom-left, bottom-right, top-right, top-left of the PAGE (v is
    // image-down, so v = aspect is the page's bottom edge) — this order is
    // counter-clockwise in y-up local space for any rotation, because a
    // similarity transform with positive scale preserves orientation.
    let corners = [
        Position(x: 0, y: pageAspectRatio),
        Position(x: 1, y: pageAspectRatio),
        Position(x: 1, y: 0),
        Position(x: 0, y: 0),
    ]
    let ring = try corners.map { try CoordinateRounding.round(applyPlanTransform(transform, to: $0)) }
    return .polygon([ring + [ring[0]]])
}

private func requireFinitePlanPoint(_ point: Position, aspect: Double, pointer: String) throws {
    let inPage =
        point.x.isFinite && point.y.isFinite
        && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= aspect
    guard inPage else {
        throw CalibrationInputError(
            code: .planPointOutsidePage,
            pointer: pointer,
            message: "\(pointer) must lie on the page: u in [0, 1], v in [0, \(aspect)]."
        )
    }
}

private func requireLocalPoint(_ point: Position, pointer: String) throws {
    let limit = GeometryTolerances.maximumCoordinateMagnitudeMetres
    let inRange =
        point.x.isFinite && point.y.isFinite && abs(point.x) <= limit && abs(point.y) <= limit
    guard inRange else {
        throw CalibrationInputError(
            code: .localPointOutOfRange,
            pointer: pointer,
            message: "\(pointer) must be finite local coordinates within ±\(limit) m."
        )
    }
}

private func validateInput(_ input: PlanCalibrationInput) throws {
    let aspect = input.pageAspectRatio
    guard aspect.isFinite, aspect > 0, aspect <= PlanCalibrationLimits.maximumPageAspectRatio else {
        throw CalibrationInputError(
            code: .pageAspectRatioInvalid,
            pointer: "/pageAspectRatio",
            message: "/pageAspectRatio must be a finite ratio in (0, \(PlanCalibrationLimits.maximumPageAspectRatio)]."
        )
    }

    let known = input.knownDistance
    try requireFinitePlanPoint(known.pointA, aspect: aspect, pointer: "/knownDistance/pointA")
    try requireFinitePlanPoint(known.pointB, aspect: aspect, pointer: "/knownDistance/pointB")
    let limit = GeometryTolerances.maximumCoordinateMagnitudeMetres
    guard known.distanceMetres.isFinite, known.distanceMetres > 0, known.distanceMetres <= limit else {
        throw CalibrationInputError(
            code: .knownDistanceNotPositive,
            pointer: "/knownDistance/distanceMetres",
            message: "/knownDistance/distanceMetres must be a positive distance in metres no greater than \(limit)."
        )
    }
    let segmentLength = hypot(known.pointB.x - known.pointA.x, known.pointB.y - known.pointA.y)
    guard segmentLength >= PlanCalibrationLimits.minimumKnownDistanceSegmentPlanUnits else {
        throw CalibrationInputError(
            code: .knownDistanceSegmentDegenerate,
            pointer: "/knownDistance",
            message: "The known-distance segment is too short to derive a scale from."
        )
    }

    guard input.referencePoints.count <= PlanCalibrationLimits.maximumControlPointCount else {
        throw CalibrationInputError(
            code: .controlPointsTooMany,
            pointer: "/referencePoints",
            message: "At most \(PlanCalibrationLimits.maximumControlPointCount) control points are supported."
        )
    }
    for (index, point) in input.referencePoints.enumerated() {
        try requireFinitePlanPoint(point.planPoint, aspect: aspect, pointer: "/referencePoints/\(index)/planPoint")
        try requireLocalPoint(point.localMetres, pointer: "/referencePoints/\(index)/localMetres")
    }

    if let manual = input.manualAdjustment {
        let valid =
            manual.rotationRadians.isFinite
            && manual.translationMetres.dx.isFinite
            && manual.translationMetres.dy.isFinite
            && abs(manual.translationMetres.dx) <= limit
            && abs(manual.translationMetres.dy) <= limit
        guard valid else {
            throw CalibrationInputError(
                code: .manualAdjustmentInvalid,
                pointer: "/manualAdjustment",
                message: "/manualAdjustment must carry finite rotation and an in-range translation."
            )
        }
    }
}

/// Derives the transform and its honest error report from calibration
/// inputs. Deterministic: identical input yields byte-identical output in
/// every runtime — the shared calibration fixtures compare exactly.
///
/// - Throws: ``CalibrationInputError`` for degenerate or out-of-range
///   inputs; ``CoordinateRangeError`` when a derived translation leaves the
///   representable local range (matching the TypeScript `roundCoordinate`).
public func derivePlanCalibration(_ input: PlanCalibrationInput) throws -> PlanCalibrationDerivation {
    try validateInput(input)

    let known = input.knownDistance
    let segmentLength = hypot(known.pointB.x - known.pointA.x, known.pointB.y - known.pointA.y)
    let scale = known.distanceMetres / segmentLength

    // Control points, y-flipped and pre-scaled: the rigid fit below solves
    // local approximately equal to R(theta) * a + t.
    let flipped = input.referencePoints.map { point in
        Position(x: scale * point.planPoint.x, y: -scale * point.planPoint.y)
    }
    let targets = input.referencePoints.map(\.localMetres)

    var fittedRotation = 0.0
    var fittedTranslation = Position(x: 0, y: 0)

    if flipped.count == 1 {
        let a = flipped[0]
        let q = targets[0]
        fittedTranslation = Position(x: q.x - a.x, y: q.y - a.y)
    } else if flipped.count >= 2 {
        let n = Double(flipped.count)
        // Accumulated in input order, exactly like the TypeScript `reduce`,
        // so intermediate floating-point state matches term for term.
        func mean(of points: [Position]) -> Position {
            Position(
                x: points.reduce(0) { $0 + $1.x } / n,
                y: points.reduce(0) { $0 + $1.y } / n
            )
        }
        let aMean = mean(of: flipped)
        let qMean = mean(of: targets)

        // 2D Kabsch with fixed scale: theta = atan2(sum of cross, sum of dot)
        // over centered point pairs.
        var dotSum = 0.0
        var crossSum = 0.0
        for index in flipped.indices {
            let a = flipped[index]
            let q = targets[index]
            let ax = a.x - aMean.x
            let ay = a.y - aMean.y
            let qx = q.x - qMean.x
            let qy = q.y - qMean.y
            dotSum += ax * qx + ay * qy
            crossSum += ax * qy - ay * qx
        }
        fittedRotation = crossSum == 0 && dotSum == 0 ? 0 : atan2(crossSum, dotSum)

        let cosine = cos(fittedRotation)
        let sine = sin(fittedRotation)
        fittedTranslation = Position(
            x: qMean.x - (aMean.x * cosine - aMean.y * sine),
            y: qMean.y - (aMean.x * sine + aMean.y * cosine)
        )
    }

    // Compose the manual adjustment (rotate about the local origin, then
    // translate) on top of the fit.
    var finalRotation = fittedRotation
    var finalTranslation = fittedTranslation
    if let manual = input.manualAdjustment {
        let cosine = cos(manual.rotationRadians)
        let sine = sin(manual.rotationRadians)
        finalRotation = fittedRotation + manual.rotationRadians
        finalTranslation = Position(
            x: fittedTranslation.x * cosine - fittedTranslation.y * sine + manual.translationMetres.dx,
            y: fittedTranslation.x * sine + fittedTranslation.y * cosine + manual.translationMetres.dy
        )
    }

    let transform = PlanTransform(
        metresPerPlanUnit: roundTo(scale, decimals: scaleDecimals),
        rotationRadians: roundTo(normalizeRotation(finalRotation), decimals: rotationDecimals),
        translationMetres: PlanTranslation(
            x: try CoordinateRounding.round(finalTranslation.x),
            y: try CoordinateRounding.round(finalTranslation.y)
        )
    )

    // Residuals against the ROUNDED final transform — the exact placement
    // that will be stored and rendered, so the reported error describes what
    // the user actually sees.
    let pointResidualsMetres = input.referencePoints.enumerated().map { index, point in
        let mapped = applyPlanTransform(transform, to: point.planPoint)
        let target = targets[index]
        return roundTo(hypot(mapped.x - target.x, mapped.y - target.y), decimals: residualDecimals)
    }

    let rmsErrorMetres: Double? =
        pointResidualsMetres.count < 2
        ? nil
        : roundTo(
            (pointResidualsMetres.reduce(0) { $0 + $1 * $1 } / Double(pointResidualsMetres.count))
                .squareRoot(),
            decimals: residualDecimals
        )

    return PlanCalibrationDerivation(
        transform: transform,
        pointResidualsMetres: pointResidualsMetres,
        rmsErrorMetres: rmsErrorMetres
    )
}
