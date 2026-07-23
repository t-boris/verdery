import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local garden read model.
///
/// This is a cache of the last server-confirmed state, populated after a
/// successful API call — not an offline outbox with pending local writes.
/// The full offline-synchronization protocol (outbox, conflict resolution,
/// tombstones) now has its schema in `CorePersistence` (`sync_outbox`,
/// `sync_cursor`, `sync_conflict`, `sync_operation_result`, `media_transfer`,
/// `local_draft` — see `CorePersistence.LocalDatabase`), but wiring any
/// feature's use cases to it, this one included, is still out of scope
/// (P5-IOS-02 and later). This table exists so the garden list has
/// something to show immediately on a cold launch, before the network
/// request completes.
///
/// Source: implementation-plan.md work packages P2-IOS-01 ("local read
/// model"), P5-IOS-01; architecture/offline-synchronization.md, section
/// "3. Non-Goals".
struct GardenRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "garden"

    let id: String
    let name: String
    let lifecycleState: String
    let callerRole: String
    let revision: Int
    let createdAt: Date
    let updatedAt: Date
}

extension GardenRecord {
    init(_ garden: Garden) {
        self.id = garden.id
        self.name = garden.name
        self.lifecycleState = garden.lifecycleState.rawValue
        self.callerRole = garden.callerRole.rawValue
        self.revision = garden.revision
        self.createdAt = garden.createdAt
        self.updatedAt = garden.updatedAt
    }

    var domainValue: Garden? {
        guard
            let lifecycleState = GardenLifecycleState(rawValue: lifecycleState),
            let callerRole = GardenRole(rawValue: callerRole)
        else {
            return nil
        }

        return Garden(
            id: id,
            name: name,
            lifecycleState: lifecycleState,
            callerRole: callerRole,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
