import Foundation

/// A photo attached to a plant.
///
/// Uploading the underlying image is out of scope this pass — see
/// `FeaturePlants`'s doc comments on `AddPlantFromPhoto`/`AttachPlantPhoto`
/// for the honest gap this leaves — but the shape is modelled fully so the
/// gateway method and its tests are contract-accurate regardless.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantPhoto`.
public struct PlantPhoto: Equatable, Sendable, Identifiable {
    public let id: String
    public let plantId: String
    public let mediaId: String
    public let isPrimary: Bool
    public let createdAt: Date

    public init(id: String, plantId: String, mediaId: String, isPrimary: Bool, createdAt: Date) {
        self.id = id
        self.plantId = plantId
        self.mediaId = mediaId
        self.isPrimary = isPrimary
        self.createdAt = createdAt
    }
}
