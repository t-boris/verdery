/// A coordinate pair. In local planar space `x` is metres east and `y` is
/// metres north of the garden origin.
public struct Position: Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// The discriminator carried by a geometry object, matching the GeoJSON member.
public enum GeometryType: String, Codable, Sendable, CaseIterable {
    case point = "Point"
    case lineString = "LineString"
    case polygon = "Polygon"
    case multiLineString = "MultiLineString"
    case multiPolygon = "MultiPolygon"
}

/// Canonical geometry.
///
/// These mirror the GeoJSON geometry object but are always transported inside an
/// envelope that names the coordinate space, because GeoJSON alone cannot say
/// whether coordinates are local metres or longitude/latitude.
///
/// Source: architecture/api-design.md, section "18. Geometry Contracts";
/// architecture/map-rendering-and-editing.md, section "5. Geometry Types".
public enum Geometry: Equatable, Sendable {
    case point(Position)
    case lineString([Position])
    /// First ring is the exterior ring; any further rings are holes.
    case polygon([[Position]])
    case multiLineString([[Position]])
    case multiPolygon([[[Position]]])

    public var type: GeometryType {
        switch self {
        case .point: .point
        case .lineString: .lineString
        case .polygon: .polygon
        case .multiLineString: .multiLineString
        case .multiPolygon: .multiPolygon
        }
    }

    /// Applies storage rounding to every coordinate in a geometry.
    ///
    /// - Throws: ``CoordinateRangeError`` when any coordinate is unrepresentable.
    public func rounded() throws -> Geometry {
        func roundLine(_ line: [Position]) throws -> [Position] {
            try line.map { try CoordinateRounding.round($0) }
        }

        switch self {
        case let .point(position):
            return .point(try CoordinateRounding.round(position))
        case let .lineString(line):
            return .lineString(try roundLine(line))
        case let .polygon(rings):
            return .polygon(try rings.map(roundLine))
        case let .multiLineString(lines):
            return .multiLineString(try lines.map(roundLine))
        case let .multiPolygon(polygons):
            return .multiPolygon(try polygons.map { try $0.map(roundLine) })
        }
    }

    /// Returns every position in a geometry, in document order.
    public var positions: [Position] {
        switch self {
        case let .point(position): [position]
        case let .lineString(line): line
        case let .polygon(rings): rings.flatMap { $0 }
        case let .multiLineString(lines): lines.flatMap { $0 }
        case let .multiPolygon(polygons): polygons.flatMap { $0.flatMap { $0 } }
        }
    }
}

/// How a piece of geometry came to exist.
///
/// Source: architecture/data-and-geospatial-design.md, section "12. Provenance".
public enum ProvenanceKind: String, Codable, Sendable, CaseIterable {
    case manualDrawing
    case userMeasurement
    case importedPlan
    case importedMapImagery
    case arMeasurement
    case imageExtraction
    case depthCapture
    case externalProvider
    case processor
}

/// A geometry together with everything a consumer needs to interpret it.
///
/// The envelope is the only form in which geometry crosses the API or the sync
/// protocol. A bare GeoJSON object is never sufficient.
public struct GeometryEnvelope: Equatable, Sendable {
    public let geometry: Geometry
    public let coordinateSpaceId: String
    public let coordinateSpaceKind: CoordinateSpaceKind
    public let provenance: ProvenanceKind
    /// Present when the geometry was drawn as a curve and remains editable as one.
    public let curve: CurveMetadata?
    /// 0…1 where the source supplies one. Absent means "not expressed", not "certain".
    public let confidence: Double?

    public init(
        geometry: Geometry,
        coordinateSpaceId: String,
        coordinateSpaceKind: CoordinateSpaceKind,
        provenance: ProvenanceKind,
        curve: CurveMetadata? = nil,
        confidence: Double? = nil
    ) {
        self.geometry = geometry
        self.coordinateSpaceId = coordinateSpaceId
        self.coordinateSpaceKind = coordinateSpaceKind
        self.provenance = provenance
        self.curve = curve
        self.confidence = confidence
    }
}
