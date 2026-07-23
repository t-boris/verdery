import CoreDomain
import CorePersistence
import GRDB

/// The local read model behind the two offline-capable observation commands
/// — what `ObservationsTimelineViewModel.load()` merges into a
/// server-fetched list, and the only durable trace of an observation this
/// device recorded or corrected purely offline until a future push engine
/// confirms it synced.
///
/// Deliberately NOT shaped like `FeatureGardens.LocalGardenStore`/
/// `FeatureMap.LocalMapStore`/`FeaturePlants.LocalPlantStore`'s
/// `commitOfflineMutation(id:command:)`, which loads "the current record"
/// from inside the transaction and hands it to the caller's closure to
/// validate against and project forward: every one of those three features
/// mutates a record in place, so there is always a `current` (possibly
/// `nil`, for a create) worth loading first. `GardenObservation` never does
/// — it is append-only by explicit domain design (see `ObservationRecord`'s
/// own doc comment): `RecordObservation` is a pure insert with nothing to
/// conflict with, and `CorrectObservation` inserts an entirely NEW row
/// rather than loading-and-mutating the one it corrects. Neither command
/// has a "current" to load, so this protocol does not force one —
/// `commitOfflineAppend` takes the already-fully-built projection and
/// operation directly, not a closure that receives a `current` neither
/// command would ever use.
public protocol LocalObservationStore: Sendable {
    /// Every observation this device has recorded or corrected purely
    /// offline for one garden, not yet known to have synced — what
    /// `FeatureObservations.ListObservationsForGarden.pending(gardenId:)`
    /// wraps for `ObservationsTimelineViewModel.load()` to merge into
    /// whatever the next `ListObservationsForGarden`/`ListObservationsForPlant`
    /// call returns, and to fall back to entirely when that call fails.
    ///
    /// Unfiltered by plant: the local pending set for one garden is expected
    /// to stay small, so a plant-scoped read would offer no benefit an
    /// in-memory filter over this result does not already give just as
    /// cheaply — unlike `ListObservationsForPlant`, which exists because the
    /// *server-side* table is not small.
    func fetchPending(gardenId: String) async throws -> [GardenObservation]

    /// Atomically appends one offline-capable observation command's new row
    /// as a single local transaction — architecture/offline-
    /// synchronization.md, section "6. Local Mutation Transaction",
    /// simplified for this append-only aggregate: there is no "load the
    /// current local record" step, because there is no current record —
    /// `RecordObservation`/`CorrectObservation` fully validate and build
    /// `observation`/`operation` before this is ever called, using only data
    /// their own caller already has. What atomicity still requires, and what
    /// this method still guarantees exactly like every other Local*Store's
    /// `commitOfflineMutation`, is that the projection insert and the outbox
    /// insert commit — or roll back — together, in one GRDB transaction.
    @discardableResult
    func commitOfflineAppend(_ observation: GardenObservation, operation: OutboxOperation) async throws -> GardenObservation
}

public struct GRDBObservationStore: LocalObservationStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetchPending(gardenId: String) async throws -> [GardenObservation] {
        try await dbQueue.read { db in
            try ObservationRecord
                .filter(Column("gardenId") == gardenId)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }

    @discardableResult
    public func commitOfflineAppend(_ observation: GardenObservation, operation: OutboxOperation) async throws -> GardenObservation {
        try await dbQueue.write { db in
            // A genuine INSERT, not `GardenRecord`/`PlantRecord`/
            // `GardenObjectRecord`'s `.save(db)` upsert: an observation row
            // is never re-written once appended (see `ObservationRecord`'s
            // own doc comment), so reusing an id here is always a defect —
            // `.insert(db)` is what surfaces that as a primary-key
            // violation instead of silently overwriting the original row.
            try ObservationRecord(observation).insert(db)
            // Same GRDB transaction as the insert above — see
            // `SyncOutboxTransactionWriter`'s own doc comment for why this,
            // not `GRDBSyncOutboxStore.enqueue(_:)`, is what atomicity here
            // requires.
            try SyncOutboxTransactionWriter.enqueue(operation, in: db)
            return observation
        }
    }
}
