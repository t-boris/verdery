import Foundation

/// Raised when a coordinate cannot be represented in the local space.
public struct CoordinateRangeError: Error, CustomStringConvertible, Sendable {
    /// Why the coordinate was rejected. The shared fixtures distinguish the two
    /// reasons, so the Swift port keeps them distinguishable as well.
    public enum Reason: String, Sendable {
        case notFinite
        case outOfRange
    }

    public let value: Double
    public let reason: Reason

    public init(value: Double, reason: Reason) {
        self.value = value
        self.reason = reason
    }

    public var description: String {
        "Coordinate \(value) is outside the supported local range of "
            + "±\(GeometryTolerances.maximumCoordinateMagnitudeMetres) m."
    }
}

/// Coordinate rounding.
///
/// Coordinates are rounded to a 1 mm grid before persistence so that the
/// backend, the Apple client, and the web client produce byte-identical output
/// for the same input. Fixtures compare exactly rather than with an epsilon, so
/// this function must behave identically in every runtime.
///
/// The rule is: scale by 10^3, round half away from zero, scale back. Every
/// runtime performs the arithmetic in IEEE 754 double precision, so the
/// intermediate representation is the same everywhere.
///
/// Source: ADR-0010, "Coordinate precision".
public enum CoordinateRounding {
    private static let scale = 1000.0

    /// Rounds one coordinate value in metres to the storage grid.
    ///
    /// Rounds half away from zero, so 0.0005 becomes 0.001 and -0.0005 becomes
    /// -0.001. Negative zero is normalized to zero so that serialized fixtures
    /// never differ by a sign bit alone.
    ///
    /// `.toNearestOrAwayFromZero` is the exact IEEE 754 counterpart of the
    /// TypeScript expression `Math.sign(x) * Math.round(Math.abs(x))`: on a
    /// non-negative operand ECMAScript `Math.round` breaks ties toward positive
    /// infinity, which is away from zero, and the sign is reapplied afterwards.
    ///
    /// - Throws: ``CoordinateRangeError`` when the value is not finite or is out of range.
    public static func round(_ value: Double) throws -> Double {
        guard value.isFinite else {
            throw CoordinateRangeError(value: value, reason: .notFinite)
        }

        guard abs(value) <= GeometryTolerances.maximumCoordinateMagnitudeMetres else {
            throw CoordinateRangeError(value: value, reason: .outOfRange)
        }

        let rounded = (value * scale).rounded(.toNearestOrAwayFromZero) / scale

        return rounded == 0 ? 0 : rounded
    }

    /// Rounds a coordinate pair.
    public static func round(_ position: Position) throws -> Position {
        Position(x: try round(position.x), y: try round(position.y))
    }

    /// True when two coordinate values refer to the same point on the storage grid.
    ///
    /// Compares rounded values rather than raw values, so callers do not need to
    /// agree on an epsilon.
    ///
    /// - Throws: ``CoordinateRangeError`` when either value is unrepresentable.
    public static func coordinatesEqual(_ left: Double, _ right: Double) throws -> Bool {
        try round(left) == (try round(right))
    }
}
