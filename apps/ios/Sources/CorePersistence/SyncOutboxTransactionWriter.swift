import CoreDomain
import GRDB

/// Enqueues an outbox operation using a `Database` connection the caller
/// already holds open, so it can be combined with another write in the same
/// GRDB transaction.
///
/// `GRDBSyncOutboxStore.enqueue(_:)` opens its own `DatabaseQueue.write`
/// block, which makes it correct on its own but unusable from inside a
/// second, unrelated `dbQueue.write` block — GRDB's writer queue is not
/// reentrant, and even if it were, two independent transactions cannot
/// guarantee the atomicity architecture/offline-synchronization.md, section
/// "6. Local Mutation Transaction" requires ("Commit both changes
/// atomically"). A feature that owns its own local read-model table in the
/// same database file — `FeatureGardens.GRDBGardenStore`, for the pilot this
/// was built for — calls this directly from inside its own single
/// `dbQueue.write` block instead, so the read-model write and the outbox
/// insert commit or roll back together.
///
/// `GRDBSyncOutboxStore.enqueue(_:)` itself is built on top of this for the
/// single-write case, so both paths assign local sequence numbers with
/// exactly the same logic.
public enum SyncOutboxTransactionWriter {
    @discardableResult
    public static func enqueue(_ operation: OutboxOperation, in db: Database) throws -> OutboxOperation {
        // Serialized by GRDB's writer queue: no two writes against this
        // `Database` connection observe the same `MAX(localSequence)`.
        let nextSequence = try Int64.fetchOne(
            db,
            sql: "SELECT COALESCE(MAX(localSequence), 0) + 1 FROM sync_outbox"
        ) ?? 1
        let assigned = operation.assigningLocalSequence(nextSequence)
        try OutboxOperationRecord(assigned).insert(db)
        return assigned
    }

    /// `Database`-parameter twin of `GRDBSyncOutboxStore.remove(operationId:)`
    /// — added for `RemoteSyncEngine+ConflictResolution.swift`'s
    /// `resolveReapplyingLocalIntent`/`resolveDuplicatingAsNewObject`, which
    /// need this removal to commit or roll back together with the new
    /// resolution operation's own `enqueue(_:in:)` call above and the
    /// conflict's own `SyncConflictTransactionWriter.resolve(...)` call, all
    /// three against the one `Database` connection a shared
    /// `SyncConflictResolutionOutboxTransaction.run(_:)` call already holds
    /// open — see `SyncTransactionContext`'s own doc comment for why.
    public static func remove(operationId: String, in db: Database) throws {
        _ = try OutboxOperationRecord.deleteOne(db, key: operationId)
    }
}
