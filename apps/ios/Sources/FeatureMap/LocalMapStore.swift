import CoreDomain
import CorePersistence
import Foundation
import GRDB

/// The local read model behind the map editor's base document: what
/// `MapEditorViewModel` renders before, or in place of, a completed network
/// request, and — since P5-IOS-02 (Stage 4b) — the durable store an offline
/// command's optimistic projection commits into.
///
/// Mirrors `FeatureGardens.LocalGardenStore`'s pattern exactly, generalized
/// from "one row per garden" to "N rows per garden": a map command can affect
/// more than one object (`splitLinework`/`joinLinework` affect three), so
/// where `LocalGardenStore.commitOfflineMutation`'s closure receives a single
/// `Garden?` and returns a single projection, this protocol's closure
/// receives every object this device currently knows about for the garden
/// and returns however many the command affected.
public protocol LocalMapStore: Sendable {
    func fetchAll(gardenId: String) async throws -> [GardenMapObject]
    func replaceAll(gardenId: String, with objects: [GardenMapObject]) async throws

    /// Atomically applies one offline-capable map command as a single local
    /// transaction — architecture/offline-synchronization.md, section
    /// "6. Local Mutation Transaction":
    ///
    /// 1. Loads every current local row for `gardenId` (a plain `[:]` for a
    ///    garden this device has never cached the map of yet).
    /// 2–5. Passes it to `command`, which validates the request and returns
    ///    the optimistic local projection(s) to apply plus the outbox
    ///    operation to enqueue — or throws to abort, leaving every table
    ///    untouched.
    /// 6. Commits the projection writes and the outbox insert together; a
    ///    failure in any of them (including a `command` throw) rolls back
    ///    all of them.
    ///
    /// `command` performs no I/O of its own — everything it needs is
    /// `current`, already loaded from the very transaction it runs inside —
    /// the same atomicity argument `LocalGardenStore.commitOfflineMutation`'s
    /// own doc comment makes.
    ///
    /// A companion to `replaceAll(gardenId:with:)`, not a replacement: that
    /// method remains for a whole document already confirmed by the server
    /// (`LoadGardenMap`); this method is only for the offline-capable
    /// commands `FeatureMap.ApplyMapCommandOffline` dispatches
    /// (`upsertCalibration`/`decideProposal` excepted — see
    /// `MapCommandError.unsupportedCommand`).
    @discardableResult
    func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: [String: GardenMapObject]) throws -> (projections: [GardenMapObject], operation: OutboxOperation)
    ) async throws -> [GardenMapObject]
}

public struct GRDBMapStore: LocalMapStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetchAll(gardenId: String) async throws -> [GardenMapObject] {
        try await dbQueue.read { db in
            try GardenObjectRecord
                .filter(Column("gardenId") == gardenId)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }

    /// Replaces `gardenId`'s whole local object set with one server-confirmed
    /// document, except any object that still has a pending offline mutation
    /// queued in `sync_outbox` — the same "do not let a necessarily-stale
    /// server response clobber an unsynced local mutation" guard
    /// `GRDBGardenStore.replaceAll(with:)`'s own doc comment explains.
    ///
    /// Queries `sync_outbox` by raw SQL against columns, exactly like
    /// `GRDBGardenStore.replaceAll(with:)` already does, rather than through
    /// any `CorePersistence` repository type — `OutboxOperationRecord` is
    /// module-internal to `CorePersistence`, so a second module reads the
    /// same table the same way that one already established. Unlike
    /// Gardens' guard, a pending row's `gardenId` column names the *owning*
    /// garden, not the specific object — the affected object ids live inside
    /// `targetRecordIds`, a JSON-array text column — so this decodes that
    /// column itself instead of a single scalar comparison.
    public func replaceAll(gardenId: String, with objects: [GardenMapObject]) async throws {
        try await dbQueue.write { db in
            let pendingTargetRecordIdsText = try String.fetchAll(
                db, sql: "SELECT targetRecordIds FROM sync_outbox WHERE gardenId = ?", arguments: [gardenId]
            )
            let pendingObjectIds = Set(pendingTargetRecordIdsText.flatMap(Self.decodeTargetRecordIds))

            let existingIds = try String.fetchAll(
                db, sql: "SELECT id FROM garden_object WHERE gardenId = ?", arguments: [gardenId]
            )
            for id in existingIds where !pendingObjectIds.contains(id) {
                try db.execute(sql: "DELETE FROM garden_object WHERE id = ?", arguments: [id])
            }

            for object in objects where !pendingObjectIds.contains(object.id) {
                try GardenObjectRecord(object).save(db)
            }
        }
    }

    @discardableResult
    public func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: [String: GardenMapObject]) throws -> (projections: [GardenMapObject], operation: OutboxOperation)
    ) async throws -> [GardenMapObject] {
        try await dbQueue.write { db in
            let current = try GardenObjectRecord
                .filter(Column("gardenId") == gardenId)
                .fetchAll(db)
                .compactMap(\.domainValue)
            let currentById = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })

            let (projections, operation) = try command(currentById)
            for projection in projections {
                try GardenObjectRecord(projection).save(db)
            }
            // Same GRDB transaction as the writes above — see
            // `SyncOutboxTransactionWriter`'s own doc comment for why this,
            // not `GRDBSyncOutboxStore.enqueue(_:)`, is what atomicity here
            // requires.
            try SyncOutboxTransactionWriter.enqueue(operation, in: db)
            return projections
        }
    }

    private static func decodeTargetRecordIds(_ text: String) -> [String] {
        guard let data = text.data(using: .utf8), let values = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return values
    }
}
