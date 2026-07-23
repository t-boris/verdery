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

    /// Upserts one server-confirmed object, except when it still has a
    /// pending offline mutation queued — mirrors
    /// `FeatureGardens.LocalGardenStore.save(_:)`'s identical "do not let a
    /// necessarily-stale server response clobber an unsynced local mutation"
    /// guard, generalized from "one row per garden" to "one object among a
    /// garden's many" the same way `replaceAll(gardenId:with:)` already is.
    /// Added in P5-IOS-03, Stage 5b, for `MapSyncRecordApplier.applyUpsert`:
    /// a pulled single-object change from another device/session is exactly
    /// this case, and `replaceAll` (a whole-document replace) would be wrong
    /// for it — it would delete every other object this device has cached
    /// for the garden that the pulled page's own bounded item set does not
    /// happen to also include.
    func save(_ object: GardenMapObject) async throws

    /// Removes one object's local cache row, except when it still has a
    /// pending offline mutation queued — the same guard `save(_:)` applies,
    /// read in the opposite direction: a pending local mutation is this
    /// device's own unsynced intent for the object, which a same-object
    /// deletion pulled from another device/session must not silently
    /// discard out from under it. A silent no-op when this device has no
    /// local row for `objectId` either way. Added in P5-IOS-03, Stage 5b,
    /// for `MapSyncRecordApplier.applyDelete` — a real, ordinary tombstone
    /// (`delete-map-object.ts`/`join`/`split-map-object-linework.ts` already
    /// produce these server-side today), not the revocation-tombstone
    /// special case `GardenSyncRecordApplier.applyDelete`'s own doc comment
    /// explains for `garden`.
    func delete(objectId: String) async throws

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

    /// Advances one map object's local revision to the server's confirmed
    /// value once this device's own pending mutation for it is accepted or
    /// duplicate-confirmed by `POST /sync/push` — the same third case
    /// `FeatureGardens.LocalGardenStore.confirmSynced(gardenId:revision:)`'s
    /// own doc comment explains, generalized to "one object among a
    /// garden's many" instead of "the one garden itself". Scoped by the
    /// object's own id, not `gardenId`, because a single push result's
    /// `recordRevisions` only ever names the specific objects a command
    /// affected — never every object in the garden. A silent no-op when
    /// this device has no local row for `objectId`.
    ///
    /// Called only by `CoreSynchronization.RemoteSyncEngine`, through
    /// `MapSyncRecordApplier` (P5-IOS-03, Stage 5a).
    func confirmSynced(objectId: String, revision: Int) async throws

    /// Removes every local `garden_object` row for `gardenId`,
    /// unconditionally — including any object with a pending offline
    /// mutation still queued, unlike `save(_:)`/`delete(objectId:)`/
    /// `replaceAll(gardenId:with:)` above. Called only by
    /// `CoreSynchronization.RemoteSyncEngine`, through
    /// `MapSyncRecordApplier.removeGardenScopedData(gardenId:)` (P5-SEC-01),
    /// as part of the cascade reaction to `gardenId`'s own access-revocation
    /// tombstone — see that protocol requirement's own doc comment for why
    /// "except when pending" does not apply here. A silent no-op when this
    /// device has no local rows for `gardenId`.
    func removeAll(gardenId: String) async throws
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

    public func save(_ object: GardenMapObject) async throws {
        try await dbQueue.write { db in
            guard try !Self.isPending(objectId: object.id, gardenId: object.gardenId, db: db) else { return }
            try GardenObjectRecord(object).save(db)
        }
    }

    public func delete(objectId: String) async throws {
        try await dbQueue.write { db in
            guard let gardenId = try String.fetchOne(db, sql: "SELECT gardenId FROM garden_object WHERE id = ?", arguments: [objectId])
            else { return }
            guard try !Self.isPending(objectId: objectId, gardenId: gardenId, db: db) else { return }
            try db.execute(sql: "DELETE FROM garden_object WHERE id = ?", arguments: [objectId])
        }
    }

    /// Shared by `save(_:)`/`delete(objectId:)` — the same `sync_outbox
    /// .targetRecordIds` lookup `replaceAll(gardenId:with:)` already performs
    /// per-object, factored out since both new methods need exactly it for
    /// one object at a time rather than a whole garden's worth.
    private static func isPending(objectId: String, gardenId: String, db: Database) throws -> Bool {
        let pendingTargetRecordIdsText = try String.fetchAll(
            db, sql: "SELECT targetRecordIds FROM sync_outbox WHERE gardenId = ?", arguments: [gardenId]
        )
        return pendingTargetRecordIdsText.contains { decodeTargetRecordIds($0).contains(objectId) }
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

    /// A surgical column-only update — see
    /// `FeatureGardens.GRDBGardenStore.confirmSynced(gardenId:revision:)`'s
    /// own doc comment for why this, not a full `GardenObjectRecord`
    /// decode/re-encode round trip (which would also risk re-throwing a
    /// `geometry`/`categoryDetails` JSON encoding failure for a value that
    /// is not actually changing), is what this method needs.
    public func confirmSynced(objectId: String, revision: Int) async throws {
        try await dbQueue.write { db in
            try db.execute(
                sql: "UPDATE \(GardenObjectRecord.databaseTableName) SET revision = ? WHERE id = ?",
                arguments: [revision, objectId]
            )
        }
    }

    public func removeAll(gardenId: String) async throws {
        try await dbQueue.write { db in
            _ = try GardenObjectRecord.filter(Column("gardenId") == gardenId).deleteAll(db)
        }
    }

    private static func decodeTargetRecordIds(_ text: String) -> [String] {
        guard let data = text.data(using: .utf8), let values = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return values
    }
}
