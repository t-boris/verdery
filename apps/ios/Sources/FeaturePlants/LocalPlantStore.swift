import CoreDomain
import CorePersistence
import Foundation
import GRDB

/// The local read model behind the five offline-capable plant commands: what
/// `commitOfflineMutation` loads as "the current record" before validating
/// and projecting a command against it. See `PlantRecord`'s own doc comment
/// for why `FeaturePlants` gained this table at all despite staying
/// always-fresh-from-server for ordinary reads.
///
/// Mirrors `FeatureGardens.LocalGardenStore`'s shape exactly — one row per
/// record, not `FeatureMap.LocalMapStore`'s "N rows per garden" — since a
/// plant command, unlike a map command, only ever targets exactly one plant.
public protocol LocalPlantStore: Sendable {
    /// The immediately-available cached row for one plant, before any
    /// network call — the plant-scoped counterpart to
    /// `FeatureGardens.ListGardens.cached()`. `PlantDetailViewModel.load()`
    /// needs this specifically (unlike `FeatureMap.LoadGardenMap`, which has
    /// no cache-first counterpart): navigating straight to a plant created
    /// offline this session must still be able to show it, even though
    /// `GetPlant`'s own network call would fail for a plant the server does
    /// not know about yet.
    func fetch(plantId: String) async throws -> Plant?

    /// Upserts one server-confirmed plant, except when it still has a
    /// pending offline mutation queued — mirrors
    /// `FeatureGardens.LocalGardenStore.save(_:)`'s identical "do not let a
    /// necessarily-stale server response clobber an unsynced local mutation"
    /// guard.
    func save(_ plant: Plant) async throws

    /// Removes one plant's local cache row, except when it still has a
    /// pending offline mutation queued — the same guard `save(_:)` applies,
    /// read in the opposite direction; see `FeatureMap.LocalMapStore
    /// .delete(objectId:)`'s own doc comment for the identical reasoning
    /// applied to `garden_object`. A silent no-op when this device has no
    /// local row for `plantId` either way. Added in P5-IOS-03, Stage 5b, for
    /// `PlantSyncRecordApplier.applyDelete` — no plant-deletion command
    /// exists server-side yet (confirmed by inspection: `plants-inventory
    /// -unit-of-work.ts` names no delete operation today), so nothing
    /// produces this tombstone in practice yet, but the wire's
    /// `SyncChange.operation` is generic across every record type and this
    /// method is a plain, unambiguous mechanical delete — no reason to leave
    /// the seam unbuilt until a producer exists.
    func delete(plantId: String) async throws

    /// Atomically applies one offline-capable plant command as a single
    /// local transaction — architecture/offline-synchronization.md, section
    /// "6. Local Mutation Transaction":
    ///
    /// 1. Loads the current local record for `plantId` (`nil` for a plant
    ///    this device has never cached, including a brand-new one — see
    ///    `AddPlant`).
    /// 2–5. Passes it to `command`, which validates the request and returns
    ///    the optimistic local projection to apply plus the outbox operation
    ///    to enqueue — or throws to abort, leaving both tables untouched.
    /// 6. Commits the projection write and the outbox insert together; a
    ///    failure in either one (including a `command` throw) rolls back
    ///    both.
    ///
    /// `command` performs no I/O of its own — everything it needs is
    /// `current`, already loaded from the very transaction it runs inside —
    /// the same atomicity argument `LocalGardenStore.commitOfflineMutation`'s
    /// own doc comment makes.
    @discardableResult
    func commitOfflineMutation(
        plantId: String,
        command: @Sendable (_ current: Plant?) throws -> (projection: Plant, operation: OutboxOperation)
    ) async throws -> Plant

    /// Advances a plant's local revision to the server's confirmed value
    /// once this device's own pending mutation for it is accepted or
    /// duplicate-confirmed by `POST /sync/push` — the same third case
    /// `FeatureGardens.LocalGardenStore.confirmSynced(gardenId:revision:)`'s
    /// own doc comment explains. A silent no-op when this device has no
    /// local row for `plantId`.
    ///
    /// Called only by `CoreSynchronization.RemoteSyncEngine`, through
    /// `PlantSyncRecordApplier` (P5-IOS-03, Stage 5a).
    func confirmSynced(plantId: String, revision: Int) async throws

    /// Removes every local `plant` row for `gardenId`, unconditionally —
    /// including any plant with a pending offline mutation still queued,
    /// unlike `save(_:)`/`delete(plantId:)` above. Called only by
    /// `CoreSynchronization.RemoteSyncEngine`, through
    /// `PlantSyncRecordApplier.removeGardenScopedData(gardenId:)`
    /// (P5-SEC-01), as part of the cascade reaction to `gardenId`'s own
    /// access-revocation tombstone — see that protocol requirement's own doc
    /// comment for why "except when pending" does not apply here. A silent
    /// no-op when this device has no local rows for `gardenId`.
    func removeAll(gardenId: String) async throws
}

public struct GRDBPlantStore: LocalPlantStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetch(plantId: String) async throws -> Plant? {
        try await dbQueue.read { db in
            try PlantRecord.fetchOne(db, key: plantId)?.domainValue
        }
    }

    public func save(_ plant: Plant) async throws {
        try await dbQueue.write { db in
            guard try !Self.isPending(plantId: plant.id, gardenId: plant.gardenId, db: db) else { return }
            try PlantRecord(plant).save(db)
        }
    }

    public func delete(plantId: String) async throws {
        try await dbQueue.write { db in
            guard let gardenId = try String.fetchOne(db, sql: "SELECT gardenId FROM plant WHERE id = ?", arguments: [plantId])
            else { return }
            guard try !Self.isPending(plantId: plantId, gardenId: gardenId, db: db) else { return }
            try db.execute(sql: "DELETE FROM plant WHERE id = ?", arguments: [plantId])
        }
    }

    @discardableResult
    public func commitOfflineMutation(
        plantId: String,
        command: @Sendable (_ current: Plant?) throws -> (projection: Plant, operation: OutboxOperation)
    ) async throws -> Plant {
        try await dbQueue.write { db in
            let current = try PlantRecord.fetchOne(db, key: plantId)?.domainValue
            let (projection, operation) = try command(current)
            try PlantRecord(projection).save(db)
            // Same GRDB transaction as the write above — see
            // `SyncOutboxTransactionWriter`'s own doc comment for why this,
            // not `GRDBSyncOutboxStore.enqueue(_:)`, is what atomicity here
            // requires.
            try SyncOutboxTransactionWriter.enqueue(operation, in: db)
            return projection
        }
    }

    /// A surgical column-only update — see
    /// `FeatureGardens.GRDBGardenStore.confirmSynced(gardenId:revision:)`'s
    /// own doc comment for why this, not a full `PlantRecord` decode/
    /// re-encode round trip, is what this method needs.
    public func confirmSynced(plantId: String, revision: Int) async throws {
        try await dbQueue.write { db in
            try db.execute(
                sql: "UPDATE \(PlantRecord.databaseTableName) SET revision = ? WHERE id = ?",
                arguments: [revision, plantId]
            )
        }
    }

    public func removeAll(gardenId: String) async throws {
        try await dbQueue.write { db in
            _ = try PlantRecord.filter(Column("gardenId") == gardenId).deleteAll(db)
        }
    }

    /// A plant's own id lives inside `sync_outbox.targetRecordIds` (a
    /// JSON-array text column), not `sync_outbox.gardenId` (the *owning*
    /// garden, shared by every plant in it) — the same reasoning
    /// `GRDBMapStore.replaceAll(gardenId:with:)`'s own doc comment gives for
    /// `garden_object`, not `GRDBGardenStore.replaceAll(with:)`'s simpler
    /// scalar comparison (a garden's id and its own `sync_outbox.gardenId`
    /// are the same value).
    private static func isPending(plantId: String, gardenId: String, db: Database) throws -> Bool {
        let pendingTargetRecordIdsText = try String.fetchAll(
            db, sql: "SELECT targetRecordIds FROM sync_outbox WHERE gardenId = ?", arguments: [gardenId]
        )
        return pendingTargetRecordIdsText.contains { decodeTargetRecordIds($0).contains(plantId) }
    }

    private static func decodeTargetRecordIds(_ text: String) -> [String] {
        guard let data = text.data(using: .utf8), let values = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return values
    }
}
