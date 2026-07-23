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
