import Foundation

/// Whether a taxonomy reference was seeded independently of any profile, or
/// defined by one.
///
/// Source: packages/api-contracts/openapi.yaml, `TaxonomySource`.
public enum TaxonomySource: String, Codable, Equatable, Sendable, CaseIterable {
    // Both wire values are snake_case, matching the contract's own literal.
    case systemCatalog = "system_catalog"
    case userDefined = "user_defined"
}

/// One entry of the read-only species catalog `AddPlant` callers pick a
/// `taxonomyReferenceId` from, via `SearchTaxonomyReferences`.
///
/// Source: packages/api-contracts/openapi.yaml, `TaxonomyReference`.
public struct TaxonomyReference: Equatable, Sendable, Identifiable {
    public let id: String
    public let scientificName: String
    public let commonName: String?
    public let varietyName: String?
    public let source: TaxonomySource
    public let createdByProfileId: String?
    public let createdAt: Date

    public init(
        id: String,
        scientificName: String,
        commonName: String?,
        varietyName: String?,
        source: TaxonomySource,
        createdByProfileId: String?,
        createdAt: Date
    ) {
        self.id = id
        self.scientificName = scientificName
        self.commonName = commonName
        self.varietyName = varietyName
        self.source = source
        self.createdByProfileId = createdByProfileId
        self.createdAt = createdAt
    }
}
