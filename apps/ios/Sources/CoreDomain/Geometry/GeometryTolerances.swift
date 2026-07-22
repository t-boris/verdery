/// Numeric geometry tolerances.
///
/// Every value here is a contract, not a rendering preference. Changing one
/// changes stored geometry or validation outcomes across the backend, the Apple
/// client, and the web client simultaneously. The values are duplicated from
/// `packages/geometry-contracts` because Swift cannot import TypeScript; the
/// shared fixtures are what keeps the two copies honest.
///
/// Source: ADR-0010, "Geometry tolerances".
public enum GeometryTolerances {
    /// Coordinate storage precision in metres. Coordinates are rounded to this grid on write.
    public static let coordinatePrecisionMetres = 0.001

    /// Decimal places implied by ``coordinatePrecisionMetres``.
    public static let coordinateDecimalPlaces = 3

    /// Two vertices closer than this are the same vertex. Matches storage precision.
    public static let vertexEpsilonMetres = 0.001

    /// Polygons smaller than this are rejected as degenerate. Smaller than a plant pot.
    public static let minimumPolygonAreaSquareMetres = 0.01

    /// Line segments shorter than this are rejected as degenerate.
    public static let minimumLineLengthMetres = 0.05

    /// Coordinates further than this from the local origin are rejected.
    public static let maximumCoordinateMagnitudeMetres = 10_000.0

    /// Maximum deviation between a curve and the polyline persisted for it.
    public static let maximumChordDeviationMetres = 0.01

    /// Snap radius in screen pixels. Clients convert this to local metres at the
    /// active zoom; it is never stored.
    ///
    /// Source: architecture/map-rendering-and-editing.md, section "3.3 Screen Space".
    public static let snapToleranceScreenPixels = 12

    /// Minimum vertex count for a closed linear ring, counting the repeated closing vertex.
    public static let minimumRingVertexCount = 4

    /// Minimum vertex count for an open line string.
    public static let minimumLineVertexCount = 2
}
