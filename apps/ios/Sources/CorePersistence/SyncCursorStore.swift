import CoreDomain
import Foundation
import GRDB

/// The durable pull cursor for one profile's whole change stream.
///
/// **Corrected from a per-garden design to a per-profile singleton**
/// (P5-IOS-03, Stage 5b): built here in Stage 3 as "one per garden
/// partition" ahead of any real consumer, and never exercised by real code
/// until now — see this work package's own report for the fuller account.
/// Direct inspection of the shipped, authoritative `GET /sync/changes`
/// contract and its server implementation confirmed pull is profile-scoped,
/// not per-garden (see `CoreDomain.SyncCursor`'s own doc comment for the
/// full evidence): the endpoint takes no `gardenId` parameter, and the
/// server computes visibility from every membership the caller has, not one
/// requested garden. Since this store's underlying database file is already
/// scoped to one profile (`LocalDatabase.open(profileIdentifier:)`), the
/// correct shape is a single row, not a table keyed by garden id — updating
/// this now, as the type's first real consumer, costs nothing beyond a new
/// migration and this stage's own tests, since Stage 3 left no other real
/// code depending on the old per-garden shape (confirmed by inspection, not
/// assumed).
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol".
public protocol SyncCursorStore: Sendable {
    /// The current cursor, or `nil` before the first successful pull page —
    /// the same "omit `after`" state `GetSyncChanges` treats as a first-ever
    /// pull.
    func current() async throws -> SyncCursor?

    /// Advances (or creates) the durable cursor. Called in the same local
    /// transaction that applies the page the new cursor value came with —
    /// see section "10. Pull Protocol": "The client applies each page in one
    /// SQLite transaction and advances the cursor only in that same
    /// transaction." Composing that transaction is `RemoteSyncEngine`'s job;
    /// this store only guarantees the write itself is atomic.
    func advance(cursor: String, at date: Date) async throws

    /// Clears the durable cursor — full resynchronization, section
    /// "13. Full Resynchronization".
    func reset() async throws
}

public struct GRDBSyncCursorStore: SyncCursorStore {
    /// The one row this table ever holds — see `SyncCursorRecord`'s own doc
    /// comment for why a fixed primary key, not an autoincrement or a
    /// garden id, is what identifies it.
    private static let singletonKey = 1

    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func current() async throws -> SyncCursor? {
        try await dbQueue.read { db in
            try SyncCursorRecord.fetchOne(db, key: Self.singletonKey)?.domainValue
        }
    }

    public func advance(cursor: String, at date: Date) async throws {
        try await dbQueue.write { db in
            try SyncCursorRecord(id: Self.singletonKey, cursor: SyncCursor(cursor: cursor, updatedAt: date)).save(db)
        }
    }

    public func reset() async throws {
        try await dbQueue.write { db in
            _ = try SyncCursorRecord.deleteOne(db, key: Self.singletonKey)
        }
    }
}
