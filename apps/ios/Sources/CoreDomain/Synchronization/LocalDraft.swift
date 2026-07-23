import Foundation

/// Local-only, never-synchronized working state — an in-progress edit with
/// no server representation yet.
///
/// Source: architecture/ios-application-design.md, section "7. Local
/// Persistence" ("Local-only drafts"). The web client keeps the same
/// concept, schema-versioned there too: architecture/web-application-
/// design.md, section "9. Online-First Behavior" ("Unsaved editor work
/// remains in a local draft") and section "6. State Ownership"
/// ("Recoverable drafts | IndexedDB or local storage adapter with explicit
/// schema").
public struct LocalDraft: Equatable, Sendable, Identifiable, Codable {
    public let id: String
    public let profileId: String
    /// `nil` for a draft that exists before any garden context, e.g. a
    /// create-garden form.
    public let gardenId: String?
    /// The kind of draft, opaque to this layer — a feature-defined string
    /// such as `"mapObjectEdit"` or `"createGardenForm"`.
    public let draftType: String
    /// Lets a future change to `payload`'s shape upcast or discard an old
    /// draft on read instead of failing to decode it.
    public let schemaVersion: Int
    public let payload: String
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        profileId: String,
        gardenId: String?,
        draftType: String,
        schemaVersion: Int,
        payload: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.profileId = profileId
        self.gardenId = gardenId
        self.draftType = draftType
        self.schemaVersion = schemaVersion
        self.payload = payload
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
