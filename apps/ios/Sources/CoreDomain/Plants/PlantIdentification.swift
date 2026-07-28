import Foundation

/// The species catalog entry a photo-identification pass suggested, resolved
/// to a friendly name — `nil` on the identification that owns it means the
/// pass found no confident candidate, matching `PlantIdentification
/// .suggestedTaxonomy`'s own nullability.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantIdentification.suggestedTaxonomy`.
public struct PlantIdentificationSuggestion: Equatable, Sendable {
    public let id: String
    public let scientificName: String
    public let commonName: String?

    public init(id: String, scientificName: String, commonName: String?) {
        self.id = id
        self.scientificName = scientificName
        self.commonName = commonName
    }
}

/// A plant's still-pending photo-identification suggestion, as
/// `AddPlantFromPhoto` (ADR-0015) produced it — readable only while pending;
/// once accepted via `ConfirmPlantIdentification`, the read this came from
/// reports `404` instead (see `FetchPlantIdentification`'s own doc comment).
///
/// Source: packages/api-contracts/openapi.yaml, `PlantIdentification`.
public struct PlantIdentification: Equatable, Sendable, Identifiable {
    public let id: String
    public let plantId: String
    public let plantPhotoId: String
    public let confidenceScore: Double
    public let createdAt: Date
    public let suggestedTaxonomy: PlantIdentificationSuggestion?

    public init(
        id: String,
        plantId: String,
        plantPhotoId: String,
        confidenceScore: Double,
        createdAt: Date,
        suggestedTaxonomy: PlantIdentificationSuggestion?
    ) {
        self.id = id
        self.plantId = plantId
        self.plantPhotoId = plantPhotoId
        self.confidenceScore = confidenceScore
        self.createdAt = createdAt
        self.suggestedTaxonomy = suggestedTaxonomy
    }
}
