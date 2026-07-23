import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local garden read model.
///
/// Originally (P2-IOS-01/P5-IOS-01) a cache of the last server-confirmed
/// state only, populated after a successful API call. As of P5-IOS-02 (the
/// offline-synchronization pilot for this feature) a row can also hold an
/// optimistic local projection that has not been server-confirmed yet —
/// `CreateGarden`, `RenameGarden`, `ArchiveGarden`, and
/// `RequestGardenDeletion` write one here in the same GRDB transaction as
/// the paired `sync_outbox` insert (`LocalGardenStore
/// .commitOfflineMutation(gardenId:command:)`), rather than only after a
/// network round trip. `replaceAll(with:)`/`save(_:)` protect any row that
/// still has a pending `sync_outbox` operation from being overwritten by a
/// server response that necessarily predates it.
///
/// The full offline-synchronization protocol otherwise (conflict
/// resolution, tombstones, an actual push/pull `SyncEngine`) still has no
/// feature wired to it — see `CoreSynchronization.LocalOnlySyncEngine`'s own
/// doc comment; that remains later stages' scope (P5-IOS-03 and beyond).
///
/// Source: implementation-plan.md work packages P2-IOS-01 ("local read
/// model"), P5-IOS-01, P5-IOS-02; architecture/offline-synchronization.md,
/// section "6. Local Mutation Transaction".
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
