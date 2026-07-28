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
/// `suggestedTaxonomy`, and the `(suggestedCommonName, suggestedScientificName)`
/// pair, are mutually exclusive — never both non-nil. Either the AI's name
/// matched this application's own taxonomy catalog (`suggestedTaxonomy` set,
/// the raw pair `nil`), or it didn't (`suggestedTaxonomy` nil, the raw pair
/// carries the AI's own name guess instead of silently discarding it), or
/// the AI was not confident/available at all (everything `nil`).
///
/// Source: packages/api-contracts/openapi.yaml, `PlantIdentification`.
public struct PlantIdentification: Equatable, Sendable, Identifiable {
    public let id: String
    public let plantId: String
    public let plantPhotoId: String
    public let confidenceScore: Double
    public let createdAt: Date
    public let suggestedTaxonomy: PlantIdentificationSuggestion?
    public let suggestedCommonName: String?
    public let suggestedScientificName: String?

    public init(
        id: String,
        plantId: String,
        plantPhotoId: String,
        confidenceScore: Double,
        createdAt: Date,
        suggestedTaxonomy: PlantIdentificationSuggestion?,
        suggestedCommonName: String? = nil,
        suggestedScientificName: String? = nil
    ) {
        self.id = id
        self.plantId = plantId
        self.plantPhotoId = plantPhotoId
        self.confidenceScore = confidenceScore
        self.createdAt = createdAt
        self.suggestedTaxonomy = suggestedTaxonomy
        self.suggestedCommonName = suggestedCommonName
        self.suggestedScientificName = suggestedScientificName
    }

    /// Whether `PlantIdentificationUseCases.ConfirmPlantIdentification` is a
    /// meaningful next action — either a resolved catalog match, or the AI's
    /// own raw name guess to name the plant from directly.
    public var hasConfirmableSuggestion: Bool {
        suggestedTaxonomy != nil || suggestedCommonName != nil
    }
}
