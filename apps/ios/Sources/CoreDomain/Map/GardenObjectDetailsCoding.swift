import Foundation

/// Wire coding for ``GardenObjectDetails``.
///
/// The TypeScript union's wire shape is `{"category": ..., "details": ...}`;
/// Swift's automatic synthesis for an enum with associated values cannot
/// produce that exact shape, so it is hand-written here — the same reason
/// `GeometryCoding.swift` hand-writes ``Geometry``'s coding.
///
/// Source: packages/geometry-contracts/src/object-category.ts.
extension GardenObjectDetails: Codable {
    private enum CodingKeys: String, CodingKey {
        case category
        case details
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        switch try container.decode(GardenObjectCategory.self, forKey: .category) {
        case .structure:
            self = .structure(try container.decode(StructureDetails.self, forKey: .details))
        case .fence:
            self = .fence(try container.decode(FenceDetails.self, forKey: .details))
        case .gate:
            self = .gate(try container.decode(GateDetails.self, forKey: .details))
        case .zone:
            self = .zone(try container.decode(ZoneDetails.self, forKey: .details))
        case .bed:
            self = .bed(try container.decode(BedDetails.self, forKey: .details))
        case .annotation:
            self = .annotation(try container.decode(AnnotationDetails.self, forKey: .details))
        case .tree:
            self = .tree(try container.decode(TreeDetails.self, forKey: .details))
        case .plant:
            self = .plant(try container.decode(PlantPlacementDetails.self, forKey: .details))
        case .utilityExclusion:
            self = .utilityExclusion(
                try container.decode(UtilityExclusionDetails.self, forKey: .details)
            )
        case .lot, .path, .waterFeature, .importedBackground:
            throw DecodingError.dataCorruptedError(
                forKey: .category,
                in: container,
                debugDescription: "This category has no category-specific detail payload."
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(category, forKey: .category)

        switch self {
        case let .structure(details): try container.encode(details, forKey: .details)
        case let .fence(details): try container.encode(details, forKey: .details)
        case let .gate(details): try container.encode(details, forKey: .details)
        case let .zone(details): try container.encode(details, forKey: .details)
        case let .bed(details): try container.encode(details, forKey: .details)
        case let .annotation(details): try container.encode(details, forKey: .details)
        case let .tree(details): try container.encode(details, forKey: .details)
        case let .plant(details): try container.encode(details, forKey: .details)
        case let .utilityExclusion(details): try container.encode(details, forKey: .details)
        }
    }
}
