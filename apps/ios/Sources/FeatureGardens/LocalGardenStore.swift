import CoreDomain
import CorePersistence
import GRDB

/// The local read model: what the garden list shows before, or in place of,
/// a completed network request.
public protocol LocalGardenStore: Sendable {
    func fetchAll() async throws -> [Garden]
    func replaceAll(with gardens: [Garden]) async throws
    func save(_ garden: Garden) async throws

    /// Atomically applies one offline-capable garden command as a single
    /// local transaction — architecture/offline-synchronization.md, section
    /// "6. Local Mutation Transaction":
    ///
    /// 1. Loads the current local record for `gardenId` (`nil` for a garden
    ///    this device has never cached, including a brand-new one — see
    ///    `CreateGarden`).
    /// 2–5. Passes it to `command`, which validates the request and returns
    ///    the optimistic local projection to apply plus the outbox operation
    ///    to enqueue — or throws to abort, leaving both tables untouched.
    /// 6. Commits the projection write and the outbox insert together; a
    ///    failure in either one (including a `command` throw) rolls back
    ///    both.
    ///
    /// `command` performs no I/O of its own — everything it needs is
    /// `current`, already loaded from the very transaction it runs inside,
    /// which is what keeps the load-validate-write-enqueue sequence a single
    /// atomic unit rather than a read followed by a separate write that a
    /// concurrent mutation could interleave with.
    ///
    /// A companion to `save(_:)`, not a replacement: `save(_:)` and
    /// `replaceAll(with:)` remain for writes already confirmed by the server
    /// (`GetGarden`, `ListGardens`); this method is only for the four
    /// offline-capable commands (`CreateGarden`, `RenameGarden`,
    /// `ArchiveGarden`, `RequestGardenDeletion`).
    @discardableResult
    func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: Garden?) throws -> (projection: Garden, operation: OutboxOperation)
    ) async throws -> Garden
}

public struct GRDBGardenStore: LocalGardenStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetchAll() async throws -> [Garden] {
        try await dbQueue.read { db in
            try GardenRecord
                .order(Column("createdAt").desc)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }

    /// Replaces the whole cache with one server-confirmed page, except any
    /// garden that still has a pending offline mutation queued in
    /// `sync_outbox`.
    ///
    /// Added alongside `commitOfflineMutation` (P5-IOS-02): before that
    /// method existed nothing could leave a row in `sync_outbox`, so a plain
    /// full replace was always correct. Now, overwriting a pending garden's
    /// row with the server's version — necessarily stale, since the push
    /// that would supersede it hasn't happened yet — would silently discard
    /// the "saved locally, not yet synchronized" state that
    /// architecture/offline-synchronization.md, section "4. Authority
    /// Model" requires SQLite to keep authoritative "until the server
    /// accepts or explicitly rejects" the pending operation.
    public func replaceAll(with gardens: [Garden]) async throws {
        try await dbQueue.write { db in
            let pendingGardenIds = try Set(String.fetchAll(db, sql: "SELECT DISTINCT gardenId FROM sync_outbox"))

            if pendingGardenIds.isEmpty {
                try GardenRecord.deleteAll(db)
            } else {
                try GardenRecord.filter(!pendingGardenIds.contains(Column("id"))).deleteAll(db)
            }

            for garden in gardens where !pendingGardenIds.contains(garden.id) {
                try GardenRecord(garden).save(db)
            }
        }
    }

    /// Upserts one server-confirmed garden, except when it still has a
    /// pending offline mutation queued — see `replaceAll(with:)`'s doc
    /// comment for why.
    public func save(_ garden: Garden) async throws {
        try await dbQueue.write { db in
            let isPending = try Bool.fetchOne(
                db,
                sql: "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE gardenId = ?)",
                arguments: [garden.id]
            ) ?? false

            guard !isPending else { return }
            try GardenRecord(garden).save(db)
        }
    }

    @discardableResult
    public func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: Garden?) throws -> (projection: Garden, operation: OutboxOperation)
    ) async throws -> Garden {
        try await dbQueue.write { db in
            let current = try GardenRecord.fetchOne(db, key: gardenId)?.domainValue
            let (projection, operation) = try command(current)
            try GardenRecord(projection).save(db)
            // Same GRDB transaction as the write above: `dbQueue.write`
            // wraps this whole closure in one `Database.inTransaction`, so
            // this insert and the `GardenRecord` save above commit or roll
            // back together — see `SyncOutboxTransactionWriter`'s own doc
            // comment for why this, not `GRDBSyncOutboxStore.enqueue(_:)`
            // (which opens its own separate transaction), is what atomicity
            // here requires.
            try SyncOutboxTransactionWriter.enqueue(operation, in: db)
            return projection
        }
    }
}
