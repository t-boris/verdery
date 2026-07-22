/// Canonical garden object categories and the GeoJSON geometry types each one
/// may use for its primary geometry.
///
/// `garden_object` carries identity, geometry, provenance, confidence, and
/// lifecycle state common to every category; the category-specific detail
/// types in `GardenObjectDetails.swift` carry only what a category adds. This
/// mirrors the database's hybrid model exactly, so a client never has to
/// reshape data between the wire and the domain.
///
/// The plant catalog (species, care profiles) is Phase 4 scope — a plant
/// placement here is a lightweight reference plus a free-text name, not a
/// foreign key into a catalog that does not exist yet.
///
/// Source: architecture/map-rendering-and-editing.md, section
/// "4. Canonical Object Categories"; architecture/data-and-geospatial-design.md,
/// section "7. Garden Object Model"; packages/geometry-contracts/src/object-category.ts.
public enum GardenObjectCategory: String, Codable, Sendable, CaseIterable {
    case lot
    case structure
    case fence
    case gate
    case path
    case zone
    case bed
    case waterFeature
    case utilityExclusion
    case tree
    case plant
    case annotation
    case importedBackground
}

extension GardenObjectCategory {
    /// The GeoJSON geometry type(s) a category's primary geometry may use.
    private static let allowedGeometryTypes: [GardenObjectCategory: Set<GeometryType>] = [
        .lot: [.polygon, .multiPolygon],
        .structure: [.polygon, .multiPolygon],
        .fence: [.lineString, .multiLineString],
        // A short segment, not a full linework category of its own.
        .gate: [.point, .lineString],
        .path: [.lineString, .multiLineString],
        .zone: [.polygon, .multiPolygon],
        .bed: [.polygon, .multiPolygon],
        .waterFeature: [.polygon, .multiPolygon],
        .utilityExclusion: [.polygon, .multiPolygon],
        // Trunk position; canopy is a second, optional geometry — see TreeDetails.
        .tree: [.point],
        .plant: [.point, .polygon],
        .annotation: [.point, .lineString],
        .importedBackground: [.polygon],
    ]

    /// True when a geometry's type is one this category's primary geometry may use.
    public static func isGeometryTypeAllowedForCategory(
        _ category: GardenObjectCategory,
        _ geometryType: GeometryType
    ) -> Bool {
        allowedGeometryTypes[category, default: []].contains(geometryType)
    }
}
