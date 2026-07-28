import Foundation

/// A photo attached to a plant.
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
