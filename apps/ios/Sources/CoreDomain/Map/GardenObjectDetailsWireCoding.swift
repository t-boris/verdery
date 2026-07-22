import Foundation

/// Flat wire coding for ``GardenObjectDetails`` — `category` alongside that
/// category's own fields in one JSON object, matching
/// `packages/api-contracts/openapi.yaml`'s `*Details` schemas exactly.
///
/// Distinct from `GardenObjectDetailsCoding.swift` (this type's own
/// `Codable` conformance, kept nested — `{"category": ..., "details":
/// {...}}`) which exists for local undo-stack bookkeeping
/// (`Tests/CoreDomainTests`' fixture-driven round trips), a purely
/// in-memory concern with no wire contract of its own. This coding is what
/// actually crosses the network: `MapCommandPayload`'s own `categoryDetails`
/// field (`MapCommandCoding.swift`) and `GardenObjectTransport.details`
/// (`CoreNetworking/MapTransport.swift`).
///
/// A confirmed contract requirement, not a guess: `services/api`'s request
/// parser reads these fields flat, and its response serializer was found
/// sending the nested shape instead and fixed to match during this work
/// package — both directions are flat on the real wire.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Map`.
public enum GardenObjectDetailsWireCoding {
    private enum CategoryKey: String, CodingKey {
        case category
    }

    public static func decode(from decoder: any Decoder) throws -> GardenObjectDetails {
        let peek = try decoder.container(keyedBy: CategoryKey.self)

        switch try peek.decode(GardenObjectCategory.self, forKey: .category) {
        case .structure:
            return .structure(try StructureDetails(from: decoder))
        case .fence:
            return .fence(try FenceDetails(from: decoder))
        case .gate:
            return .gate(try GateDetails(from: decoder))
        case .zone:
            return .zone(try ZoneDetails(from: decoder))
        case .bed:
            return .bed(try BedDetails(from: decoder))
        case .annotation:
            return .annotation(try AnnotationDetails(from: decoder))
        case .tree:
            return .tree(try TreeDetails(from: decoder))
        case .plant:
            return .plant(try PlantPlacementDetails(from: decoder))
        case .utilityExclusion:
            return .utilityExclusion(try UtilityExclusionDetails(from: decoder))
        case .lot, .path, .waterFeature, .importedBackground:
            throw DecodingError.dataCorruptedError(
                forKey: .category,
                in: peek,
                debugDescription: "This category has no category-specific detail payload."
            )
        }
    }

    /// Encodes `category` and the case's own fields as siblings into
    /// `encoder`'s single top-level container — two `container(keyedBy:)`
    /// acquisitions from the same `Encoder` share its underlying storage, so
    /// this produces one flat JSON object, not two.
    public static func encode(_ value: GardenObjectDetails, to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CategoryKey.self)
        try container.encode(value.category, forKey: .category)

        switch value {
        case let .structure(details): try details.encode(to: encoder)
        case let .fence(details): try details.encode(to: encoder)
        case let .gate(details): try details.encode(to: encoder)
        case let .zone(details): try details.encode(to: encoder)
        case let .bed(details): try details.encode(to: encoder)
        case let .annotation(details): try details.encode(to: encoder)
        case let .tree(details): try details.encode(to: encoder)
        case let .plant(details): try details.encode(to: encoder)
        case let .utilityExclusion(details): try details.encode(to: encoder)
        }
    }
}
