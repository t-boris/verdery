import Foundation

/// GeoJSON coding for ``Position`` and ``Geometry``.
///
/// The wire form is a bare array of numbers, nested once per geometry rank, so
/// the coding cannot be synthesized. Keeping it in its own file leaves the
/// geometry model itself free of transport concerns.
///
/// Source: architecture/api-design.md, section "18. Geometry Contracts".
extension Position: Codable {
    public init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        let x = try container.decode(Double.self)
        let y = try container.decode(Double.self)

        // GeoJSON permits a third elevation ordinate. The foundation release is
        // strictly two-dimensional, so extra ordinates are a contract violation
        // rather than something to silently discard.
        guard container.isAtEnd else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "A position must contain exactly two ordinates."
            )
        }

        self.init(x: x, y: y)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(x)
        try container.encode(y)
    }
}

extension Geometry: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case coordinates
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        switch try container.decode(GeometryType.self, forKey: .type) {
        case .point:
            self = .point(try container.decode(Position.self, forKey: .coordinates))
        case .lineString:
            self = .lineString(try container.decode([Position].self, forKey: .coordinates))
        case .polygon:
            self = .polygon(try container.decode([[Position]].self, forKey: .coordinates))
        case .multiLineString:
            self = .multiLineString(try container.decode([[Position]].self, forKey: .coordinates))
        case .multiPolygon:
            self = .multiPolygon(try container.decode([[[Position]]].self, forKey: .coordinates))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)

        switch self {
        case let .point(position):
            try container.encode(position, forKey: .coordinates)
        case let .lineString(line):
            try container.encode(line, forKey: .coordinates)
        case let .polygon(rings):
            try container.encode(rings, forKey: .coordinates)
        case let .multiLineString(lines):
            try container.encode(lines, forKey: .coordinates)
        case let .multiPolygon(polygons):
            try container.encode(polygons, forKey: .coordinates)
        }
    }
}
