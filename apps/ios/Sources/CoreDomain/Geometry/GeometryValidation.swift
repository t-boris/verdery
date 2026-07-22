import Foundation

public enum ValidationSeverity: String, Sendable, CaseIterable {
    case error
    case warning
}

/// A value interpolated into a localized validation message.
///
/// The set is deliberately narrow: parameters are data, never prose, so that
/// the localized string is the only place where language appears.
public enum ValidationParameter: Equatable, Sendable {
    case number(Double)
    case text(String)
}

/// A stable, localizable validation outcome.
///
/// Issue codes are what clients localize against; the code is part of the
/// contract and is identical in every runtime.
public struct ValidationIssue: Equatable, Sendable {
    public let code: String
    public let severity: ValidationSeverity
    public let parameters: [String: ValidationParameter]

    public init(
        code: String,
        severity: ValidationSeverity,
        parameters: [String: ValidationParameter] = [:]
    ) {
        self.code = code
        self.severity = severity
        self.parameters = parameters
    }
}

/// Every validation code this module can emit.
///
/// Enumerating them lets the localization catalogue be checked for completeness
/// by a test rather than by inspection.
public enum GeometryValidationCode {
    public static let coordinateNotFinite = "geometry.coordinate.not_finite"
    public static let coordinateOutOfRange = "geometry.coordinate.out_of_range"
    public static let empty = "geometry.empty"
    public static let polygonTooFewVertices = "geometry.polygon.too_few_vertices"
    public static let polygonNotClosed = "geometry.polygon.not_closed"
    public static let polygonSelfIntersects = "geometry.polygon.self_intersects"
    public static let polygonBelowMinimumArea = "geometry.polygon.below_minimum_area"
    public static let lineTooFewVertices = "geometry.line.too_few_vertices"
    public static let lineBelowMinimumLength = "geometry.line.below_minimum_length"

    public static let all: [String] = [
        coordinateNotFinite,
        coordinateOutOfRange,
        empty,
        polygonTooFewVertices,
        polygonNotClosed,
        polygonSelfIntersects,
        polygonBelowMinimumArea,
        lineTooFewVertices,
        lineBelowMinimumLength,
    ]
}

/// Shared geometry validation.
///
/// Clients run these checks for immediate feedback; the server runs the same
/// checks and is authoritative. Both use the same rules so a warning never
/// appears on one surface and not the other.
///
/// Source: architecture/map-rendering-and-editing.md, section "11. Validation".
public enum GeometryValidation {
    /// Validates a geometry against the shared tolerances.
    ///
    /// Returns every issue found rather than stopping at the first, so a client
    /// can present a complete list. An empty array means the geometry is
    /// acceptable.
    public static func validate(_ geometry: Geometry) -> [ValidationIssue] {
        let positionIssues = validatePositions(geometry)

        guard positionIssues.isEmpty else {
            return positionIssues
        }

        switch geometry {
        case .point:
            return []

        case let .lineString(line):
            return validateLine(line)

        case let .multiLineString(lines):
            guard !lines.isEmpty else { return [error(GeometryValidationCode.empty)] }
            return lines.flatMap(validateLine)

        case let .polygon(rings):
            guard !rings.isEmpty else { return [error(GeometryValidationCode.empty)] }
            return rings.flatMap(validateRing)

        case let .multiPolygon(polygons):
            guard !polygons.isEmpty else { return [error(GeometryValidationCode.empty)] }
            return polygons.flatMap { $0.flatMap(validateRing) }
        }
    }

    /// True when a geometry has no blocking issues.
    public static func isValid(_ geometry: Geometry) -> Bool {
        validate(geometry).allSatisfy { $0.severity != .error }
    }

    private static func error(
        _ code: String,
        _ parameters: [String: ValidationParameter] = [:]
    ) -> ValidationIssue {
        ValidationIssue(code: code, severity: .error, parameters: parameters)
    }

    private static func validatePositions(_ geometry: Geometry) -> [ValidationIssue] {
        for position in geometry.positions {
            for value in [position.x, position.y] {
                guard value.isFinite else {
                    return [error(GeometryValidationCode.coordinateNotFinite)]
                }

                guard abs(value) <= GeometryTolerances.maximumCoordinateMagnitudeMetres else {
                    return [outOfRangeIssue(for: value)]
                }
            }
        }

        return []
    }

    /// Reports the offending coordinate clamped to the limit.
    ///
    /// The raw value is out of range by definition, so it is clamped before
    /// rounding; that keeps the reported parameter representable and means the
    /// rounding step cannot itself fail.
    private static func outOfRangeIssue(for value: Double) -> ValidationIssue {
        let limit = GeometryTolerances.maximumCoordinateMagnitudeMetres
        let clamped = (value < 0 ? -1.0 : 1.0) * min(abs(value), limit)
        let reported = (try? CoordinateRounding.round(clamped)) ?? clamped

        return error(
            GeometryValidationCode.coordinateOutOfRange,
            ["value": .number(reported), "limitMetres": .number(limit)]
        )
    }

    private static func validateRing(_ ring: [Position]) -> [ValidationIssue] {
        guard ring.count >= GeometryTolerances.minimumRingVertexCount else {
            return [
                error(
                    GeometryValidationCode.polygonTooFewVertices,
                    [
                        "minimum": .number(Double(GeometryTolerances.minimumRingVertexCount)),
                        "actual": .number(Double(ring.count)),
                    ]
                )
            ]
        }

        guard GeometryMeasurement.positionsCoincide(ring[0], ring[ring.count - 1]) else {
            return [error(GeometryValidationCode.polygonNotClosed)]
        }

        var issues: [ValidationIssue] = []

        if GeometryMeasurement.ringSelfIntersects(ring) {
            issues.append(error(GeometryValidationCode.polygonSelfIntersects))
        }

        if GeometryMeasurement.ringArea(ring) < GeometryTolerances.minimumPolygonAreaSquareMetres {
            issues.append(
                error(
                    GeometryValidationCode.polygonBelowMinimumArea,
                    [
                        "minimumSquareMetres":
                            .number(GeometryTolerances.minimumPolygonAreaSquareMetres)
                    ]
                )
            )
        }

        return issues
    }

    private static func validateLine(_ line: [Position]) -> [ValidationIssue] {
        guard line.count >= GeometryTolerances.minimumLineVertexCount else {
            return [
                error(
                    GeometryValidationCode.lineTooFewVertices,
                    [
                        "minimum": .number(Double(GeometryTolerances.minimumLineVertexCount)),
                        "actual": .number(Double(line.count)),
                    ]
                )
            ]
        }

        guard GeometryMeasurement.lineLength(line) >= GeometryTolerances.minimumLineLengthMetres
        else {
            return [
                error(
                    GeometryValidationCode.lineBelowMinimumLength,
                    ["minimumMetres": .number(GeometryTolerances.minimumLineLengthMetres)]
                )
            ]
        }

        return []
    }
}
