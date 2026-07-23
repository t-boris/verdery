import Foundation

/// The durable pull position for one profile's whole change stream.
///
/// **Corrected from a per-garden design to a per-profile one** (P5-IOS-03,
/// Stage 5b): this type originally carried a `gardenId` and this doc comment
/// described "one per garden partition," matching an early reading of
/// architecture/offline-synchronization.md, section "10. Pull Protocol".
/// That section's own example (`GET /v1/sync/changes?after=<opaqueCursor>&
/// limit=<boundedLimit>`) never actually names a garden, and the shipped,
/// authoritative server contract confirms why: `packages/api-contracts/
/// openapi.yaml`'s `/sync/changes` operation declares exactly three
/// parameters (`after`, `limit`, `protocolVersion`) — no `gardenId` anywhere
/// — and `GetSyncChanges.execute` (`services/api/src/modules/
/// synchronization/application/get-sync-changes.ts`) computes
/// `activeGardenIds` from *every* membership the authenticated profile has,
/// not one requested garden. Pull is profile-scoped, exactly like push
/// (section "8. Push Protocol"); only the *server's* internal `sequence`
/// numbering happens to also be "strictly increasing within a garden
/// partition" as an incidental property of one global counter, not evidence
/// of a per-garden request shape. Confirmed by direct inspection of the
/// shipped contract and backend, not assumed from this type's own Stage 3
/// doc comment — this is exactly the kind of stale scaffolding assumption
/// `CorePersistence.SyncCursorStore`'s own doc comment now calls out
/// explicitly, since Stage 5b is genuinely the first real consumer.
///
/// A profile-scoped cursor needs no explicit key at all: each signed-in
/// profile already has its own SQLite database file
/// (`CorePersistence.LocalDatabase.open(profileIdentifier:)`), so the
/// database file itself is the partition boundary — one cursor row per
/// database, not one row per garden inside it.
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol".
public struct SyncCursor: Equatable, Sendable, Codable {
    /// Opaque; the server defines its shape (`GET /v1/sync/changes?after=
    /// <opaqueCursor>`). Never parsed or constructed by the client.
    public let cursor: String
    public let updatedAt: Date

    public init(cursor: String, updatedAt: Date) {
        self.cursor = cursor
        self.updatedAt = updatedAt
    }
}
