import CoreDomain
import CorePersistence
import Foundation
import GRDB

/// The local read model behind the seven offline-capable task commands: what
/// `TasksListViewModel` renders before, or in place of, a completed network
/// request, and what `commitOfflineMutation` loads as "the current record"
/// before validating and projecting a command against it.
///
/// A hybrid of `FeaturePlants.LocalPlantStore`'s shape (`commitOfflineMutation`
/// loads and projects exactly one record — a task command, like a plant
/// command, only ever targets one task) and `FeatureMap.LocalMapStore`'s
/// shape (`fetchAll`/`replaceAll` are scoped by `gardenId`, not global — a
/// task list, like a garden's map, is read and refreshed one whole garden at
/// a time, not one record at a time the way `FeatureGardens.LocalGardenStore`
/// reads a global, ungrouped list). Neither precedent alone fits: Tasks needs
/// per-record projection (Plants' shape) over a per-garden list (Map's
/// shape).
public protocol LocalTaskStore: Sendable {
    /// The immediately-available cached list for one garden, before any
    /// network call — the garden-scoped counterpart to
    /// `FeatureGardens.ListGardens.cached()`.
    func fetchAll(gardenId: String) async throws -> [GardenTask]

    /// Replaces one garden's whole local task list with a server-confirmed
    /// page, except any task that still has a pending offline mutation
    /// queued in `sync_outbox` — the same "do not let a necessarily-stale
    /// server response clobber an unsynced local mutation" guard
    /// `FeatureMap.LocalMapStore.replaceAll(gardenId:with:)`'s own doc
    /// comment explains, applied to `task` instead of `garden_object`.
    func replaceAll(gardenId: String, with tasks: [GardenTask]) async throws

    /// Atomically applies one offline-capable task command as a single local
    /// transaction — architecture/offline-synchronization.md, section
    /// "6. Local Mutation Transaction":
    ///
    /// 1. Loads the current local record for `taskId` (`nil` for a task this
    ///    device has never cached, including a brand-new one — see
    ///    `CreateManualTask`).
    /// 2–5. Passes it to `command`, which validates the request and returns
    ///    the optimistic local projection to apply plus the outbox operation
    ///    to enqueue — or throws to abort, leaving both tables untouched.
    /// 6. Commits the projection write and the outbox insert together; a
    ///    failure in either one (including a `command` throw) rolls back
    ///    both.
    ///
    /// `command` performs no I/O of its own — everything it needs is
    /// `current`, already loaded from the very transaction it runs inside —
    /// the same atomicity argument `LocalPlantStore.commitOfflineMutation`'s
    /// own doc comment makes.
    @discardableResult
    func commitOfflineMutation(
        taskId: String,
        command: @Sendable (_ current: GardenTask?) throws -> (projection: GardenTask, operation: OutboxOperation)
    ) async throws -> GardenTask

    /// Advances a task's local revision to the server's confirmed value once
    /// this device's own pending mutation for it is accepted or
    /// duplicate-confirmed by `POST /sync/push` — the same third case
    /// `FeatureGardens.LocalGardenStore.confirmSynced(gardenId:revision:)`'s
    /// own doc comment explains. A silent no-op when this device has no
    /// local row for `taskId`.
    ///
    /// Called only by `CoreSynchronization.RemoteSyncEngine`, through
    /// `TaskSyncRecordApplier` (P5-IOS-03, Stage 5a).
    func confirmSynced(taskId: String, revision: Int) async throws
}

public struct GRDBTaskStore: LocalTaskStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetchAll(gardenId: String) async throws -> [GardenTask] {
        try await dbQueue.read { db in
            try TaskRecord
                .filter(Column("gardenId") == gardenId)
                .order(Column("createdAt").desc)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }

    /// Queries `sync_outbox` by raw SQL against columns, exactly like
    /// `GRDBMapStore.replaceAll(gardenId:with:)`/`GRDBPlantStore.save(_:)`
    /// already do, rather than through any `CorePersistence` repository type
    /// — `OutboxOperationRecord` is module-internal to `CorePersistence`, so
    /// a second module reads the same table the same way those already
    /// established. A pending row's `targetRecordIds` (a JSON-array text
    /// column) names the task itself, not `gardenId` (the *owning* garden,
    /// shared by every task in it) — the same distinction `GRDBPlantStore
    /// .isPending`'s own doc comment draws for `plant`.
    public func replaceAll(gardenId: String, with tasks: [GardenTask]) async throws {
        try await dbQueue.write { db in
            let pendingTargetRecordIdsText = try String.fetchAll(
                db, sql: "SELECT targetRecordIds FROM sync_outbox WHERE gardenId = ?", arguments: [gardenId]
            )
            let pendingTaskIds = Set(pendingTargetRecordIdsText.flatMap(Self.decodeTargetRecordIds))

            let existingIds = try String.fetchAll(
                db, sql: "SELECT id FROM task WHERE gardenId = ?", arguments: [gardenId]
            )
            for id in existingIds where !pendingTaskIds.contains(id) {
                try db.execute(sql: "DELETE FROM task WHERE id = ?", arguments: [id])
            }

            for task in tasks where !pendingTaskIds.contains(task.id) {
                try TaskRecord(task).save(db)
            }
        }
    }

    @discardableResult
    public func commitOfflineMutation(
        taskId: String,
        command: @Sendable (_ current: GardenTask?) throws -> (projection: GardenTask, operation: OutboxOperation)
    ) async throws -> GardenTask {
        try await dbQueue.write { db in
            let current = try TaskRecord.fetchOne(db, key: taskId)?.domainValue
            let (projection, operation) = try command(current)
            try TaskRecord(projection).save(db)
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
    /// own doc comment for why this, not a full `TaskRecord` decode/
    /// re-encode round trip, is what this method needs.
    public func confirmSynced(taskId: String, revision: Int) async throws {
        try await dbQueue.write { db in
            try db.execute(
                sql: "UPDATE \(TaskRecord.databaseTableName) SET revision = ? WHERE id = ?",
                arguments: [revision, taskId]
            )
        }
    }

    private static func decodeTargetRecordIds(_ text: String) -> [String] {
        guard let data = text.data(using: .utf8), let values = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return values
    }
}
