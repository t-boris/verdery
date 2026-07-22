/// Coordinate space identity.
///
/// The product stores accepted editable geometry in a garden-local planar space
/// measured in metres. That space is registered in PostGIS as SRID 0 — an
/// undefined Cartesian system — so that no consumer can mistake it for
/// EPSG:4326. Application-level identity lives in `coordinateSpaceId`.
///
/// Source: ADR-0010, "Coordinate space registration";
/// architecture/data-and-geospatial-design.md, section "8. Local Coordinate Space".
public enum CoordinateSpaceRegistration {
    /// PostGIS SRID used for garden-local planar geometry.
    ///
    /// SRID 0 means "no reference system declared". It is deliberately not a
    /// registered projected system: the origin is per garden and arbitrary.
    public static let localPlanarSrid = 0

    /// PostGIS SRID for geographic geometry, used only where a garden is georeferenced.
    public static let geographicSrid = 4326

    /// Returns the PostGIS SRID for a coordinate space kind.
    public static func srid(for kind: CoordinateSpaceKind) -> Int {
        kind == .localPlanarMetres ? localPlanarSrid : geographicSrid
    }

    /// True when a SRID denotes local planar coordinates.
    ///
    /// Used at persistence boundaries to reject geometry that would otherwise be
    /// written into the wrong column.
    public static func isLocalPlanar(srid: Int) -> Bool {
        srid == localPlanarSrid
    }
}

/// Which space a set of coordinates belongs to.
///
/// Standard GeoJSON carries no such marker, so every geometry envelope crossing
/// the API states it explicitly.
///
/// Source: architecture/api-design.md, section "18. Geometry Contracts".
public enum CoordinateSpaceKind: String, Codable, Sendable, CaseIterable {
    case localPlanarMetres
    case geographicWgs84
}

/// Axis orientation of a garden-local space. Recorded once and stable afterwards.
public enum AxisConvention: String, Codable, Sendable, CaseIterable {
    case xEastYNorth
}

/// A garden's local planar coordinate space.
public struct LocalCoordinateSpace: Equatable, Sendable, Codable {
    /// UUIDv7 identifying this space.
    public let id: String
    public let axisConvention: AxisConvention
    /// Human-readable description of what the origin corresponds to on the ground.
    public let originDescription: String

    public init(id: String, axisConvention: AxisConvention = .xEastYNorth, originDescription: String) {
        self.id = id
        self.axisConvention = axisConvention
        self.originDescription = originDescription
    }

    /// Always local planar; the type exists to make the other case unrepresentable.
    public var kind: CoordinateSpaceKind { .localPlanarMetres }
}
