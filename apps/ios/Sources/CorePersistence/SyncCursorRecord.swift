import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `sync_cursor` — a singleton table, one row for the
/// whole profile-scoped database file (see `CoreDomain.SyncCursor`'s own doc
/// comment for why pull needs no per-garden key). `id` is always `1`; GRDB's
/// `.save(db)` upserts against it the same way `GardenRecord.save(db)`
/// upserts against `garden.id`, so `GRDBSyncCursorStore.advance` needs no
/// separate "does a row already exist" check.
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol".
struct SyncCursorRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_cursor"

    let id: Int
    let cursor: String
    let updatedAt: Date
}

extension SyncCursorRecord {
    init(id: Int, cursor: SyncCursor) {
        self.id = id
        self.cursor = cursor.cursor
        self.updatedAt = cursor.updatedAt
    }

    var domainValue: SyncCursor {
        SyncCursor(cursor: cursor, updatedAt: updatedAt)
    }
}
