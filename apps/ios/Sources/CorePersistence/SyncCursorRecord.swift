import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `sync_cursor`.
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol".
struct SyncCursorRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_cursor"

    let gardenId: String
    let cursor: String
    let updatedAt: Date
}

extension SyncCursorRecord {
    init(_ cursor: SyncCursor) {
        self.gardenId = cursor.gardenId
        self.cursor = cursor.cursor
        self.updatedAt = cursor.updatedAt
    }

    var domainValue: SyncCursor {
        SyncCursor(gardenId: gardenId, cursor: cursor, updatedAt: updatedAt)
    }
}
