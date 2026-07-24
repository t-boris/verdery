import CoreDomain
import Foundation
import GRDB

/// One already-open GRDB write transaction, exposed through GRDB-free
/// methods only — the composability primitive `RemoteSyncEngine
/// +ConflictResolution.swift`'s `resolveReapplyingLocalIntent`/
/// `resolveDuplicatingAsNewObject` need to commit their outbox removal,
/// outbox enqueue, and conflict resolution as one real SQLite transaction
/// instead of three independent `SyncOutboxStore`/`SyncConflictStore` calls
/// (found during P5-QA-01; see `RemoteSyncEngine+ConflictResolution.swift`'s
/// own header comment for the full account of the gap this closes).
///
/// Mirrors `SyncOutboxTransactionWriter`'s own established pattern —
/// `GRDBGardenStore.commitOfflineMutation` (Stage 4a) already proved that a
/// `Database`-parameter-taking variant, called from inside one
/// `dbQueue.write` block, is what atomicity across more than one
/// `CorePersistence` table requires, since each store's own ordinary method
/// opens its own separate transaction and is therefore not composable with
/// another store's the naive way. This type packages that same idea as a
/// value `CoreSynchronization` can hold and pass through without ever
/// importing GRDB itself: every method below returns/accepts only
/// `CoreDomain`/`Foundation` types, so `RemoteSyncEngine+ConflictResolution
/// .swift` (which already imports `CorePersistence`) can call them freely
/// while staying within architecture/ios-application-design.md, section
/// "21. Dependency Rules" ("GRDB ... types remain inside adapters or feature
/// infrastructure").
///
/// Deliberately scoped to the outbox and conflict stores only, not the
/// third store `RemoteSyncEngine+ConflictResolution.swift`'s recovery paths
/// also touch (whichever feature-specific local store `conflict.recordType`
/// maps to, through `SyncPullRecordApplier.applyUpsert`) — see that file's
/// own header comment for why extending real atomicity to that third,
/// dynamically-dispatched store is a genuinely larger, separate change this
/// stage does not make, and for the honest account of what residual risk
/// that leaves.
/// Not `Sendable`, deliberately, mirroring GRDB's own `Database` (which this
/// type wraps): "Explicit non-conformance to Sendable: `Database` must be
/// used from a serialized database access dispatch queue" — see that type's
/// own comment in GRDB's `Database.swift`. A value of this type only ever
/// exists for the duration of one synchronous `dbQueue.write` closure
/// invocation (`GRDBSyncConflictResolutionOutboxTransaction.run(_:)`, below)
/// and is never held past it, the same safety property `Database` itself
/// already relies on.
public struct SyncTransactionContext {
    private let db: Database

    init(db: Database) {
        self.db = db
    }

    @discardableResult
    public func enqueueOutboxOperation(_ operation: OutboxOperation) throws -> OutboxOperation {
        try SyncOutboxTransactionWriter.enqueue(operation, in: db)
    }

    public func removeOutboxOperation(operationId: String) throws {
        try SyncOutboxTransactionWriter.remove(operationId: operationId, in: db)
    }

    public func removeConflict(conflictId: String) throws {
        try SyncConflictTransactionWriter.remove(conflictId: conflictId, in: db)
    }

    public func resolveConflict(conflictId: String, resolutionOperationId: String, at date: Date) throws {
        try SyncConflictTransactionWriter.resolve(conflictId: conflictId, resolutionOperationId: resolutionOperationId, at: date, in: db)
    }
}

/// Opens one `SyncTransactionContext` and runs `body` inside it — the seam
/// `RemoteSyncEngine` holds instead of a raw `DatabaseQueue`, keeping
/// `CoreSynchronization` free of GRDB per the same dependency rule
/// `SyncTransactionContext`'s own doc comment cites.
///
/// `Optional` at every injection site (`RemoteSyncEngine.init`'s own
/// parameter default is `nil`): when absent, `RemoteSyncEngine
/// +ConflictResolution.swift` falls back to the three-separate-calls
/// sequence this type exists to replace, unchanged from before this stage —
/// every existing test double (`InMemorySyncOutboxStore`/
/// `InMemorySyncConflictStore`, both actors) keeps working exactly as it did
/// without needing a matching conformer of this protocol, and the in-memory
/// fallback path `AppCompositionRoot` uses when the on-disk database cannot
/// be opened stays unaffected too — appropriately, since an in-memory store
/// has no on-disk state a crash could leave inconsistent in the first place.
public protocol SyncConflictResolutionOutboxTransaction: Sendable {
    func run<T: Sendable>(_ body: @escaping @Sendable (SyncTransactionContext) throws -> T) async throws -> T
}

public struct GRDBSyncConflictResolutionOutboxTransaction: SyncConflictResolutionOutboxTransaction {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func run<T: Sendable>(_ body: @escaping @Sendable (SyncTransactionContext) throws -> T) async throws -> T {
        try await dbQueue.write { db in try body(SyncTransactionContext(db: db)) }
    }
}
