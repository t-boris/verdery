import Foundation

/// The durable pull position for one garden partition.
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol" ("The client requests changes after its durable cursor ... The
/// client applies each page in one SQLite transaction and advances the
/// cursor only in that same transaction").
public struct SyncCursor: Equatable, Sendable, Codable {
    public let gardenId: String
    /// Opaque; the server defines its shape (`GET /v1/sync/changes?after=
    /// <opaqueCursor>`). Never parsed or constructed by the client.
    public let cursor: String
    public let updatedAt: Date

    public init(gardenId: String, cursor: String, updatedAt: Date) {
        self.gardenId = gardenId
        self.cursor = cursor
        self.updatedAt = updatedAt
    }
}
