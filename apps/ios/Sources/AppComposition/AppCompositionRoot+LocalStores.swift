import CoreDomain
import CoreObservability
import CorePersistence
import FeatureGardens
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureTasks
import Foundation

/// The per-profile local database handles: one fresh repository per call
/// over the single database file `CorePersistence.LocalDatabase` manages,
/// plus the profile identifier they are all scoped by.
///
/// Split from `AppCompositionRoot.swift` when P7-IOS-01's recommendation
/// wiring pushed that file past the 600-line limit — a topic-scoped
/// extension file, the same mechanics `TasksListViewModelActions.swift`
/// uses. The factories are module-internal (not `private`) only because a
/// same-type extension in another file cannot see `private` members; nothing
/// outside `AppComposition` can reach them regardless.
extension AppCompositionRoot {
    /// Scoped by Firebase UID; see `CorePersistence.LocalDatabase` for why
    /// that, not the application profile ID, is what "per-profile" means on
    /// this client.
    ///
    /// Opened fresh per call rather than cached: SQLite connections are cheap
    /// to open relative to a screen's lifetime, and this avoids holding a
    /// database handle open for a profile that has since signed out.
    func localGardenStore() -> any LocalGardenStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBGardenStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local garden database; falling back to an in-memory store.")
            return InMemoryGardenStore()
        }
    }

    /// Same database file, same fallback behavior as `localGardenStore()` —
    /// `garden` and `garden_object` are two tables in the one per-profile
    /// database `LocalDatabase.open` manages, per
    /// `LocalDatabase+MapObjectMigration.swift`'s own doc comment.
    func localMapStore() -> any LocalMapStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBMapStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local map database; falling back to an in-memory store.")
            return InMemoryMapStore()
        }
    }

    /// Same database file, same fallback behavior as `localGardenStore()`/
    /// `localMapStore()` — `garden`, `garden_object`, and `plant` are three
    /// tables in the one per-profile database `LocalDatabase.open` manages,
    /// per `LocalDatabase+PlantMigration.swift`'s own doc comment.
    func localPlantStore() -> any LocalPlantStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBPlantStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local plant database; falling back to an in-memory store.")
            return InMemoryPlantStore()
        }
    }

    /// Same database file, same fallback behavior as `localGardenStore()`/
    /// `localMapStore()`/`localPlantStore()` — `garden`, `garden_object`,
    /// `plant`, and `observation` are four tables in the one per-profile
    /// database `LocalDatabase.open` manages, per
    /// `LocalDatabase+ObservationMigration.swift`'s own doc comment.
    func localObservationStore() -> any LocalObservationStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBObservationStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local observation database; falling back to an in-memory store.")
            return InMemoryObservationStore()
        }
    }

    /// Same database file, same fallback behavior as `localGardenStore()`/
    /// `localMapStore()`/`localPlantStore()`/`localObservationStore()` —
    /// `garden`, `garden_object`, `plant`, `observation`, and `task` are five
    /// tables in the one per-profile database `LocalDatabase.open` manages,
    /// per `LocalDatabase+TaskMigration.swift`'s own doc comment.
    func localTaskStore() -> any LocalTaskStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBTaskStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local task database; falling back to an in-memory store.")
            return InMemoryTaskStore()
        }
    }

    /// Same database file, same fallback behavior as `localGardenStore()`/
    /// `localMapStore()`/`localPlantStore()`/`localObservationStore()`/
    /// `localTaskStore()` — `sync_conflict` is one more table in the one
    /// per-profile database `LocalDatabase.open` manages. Not itself a
    /// `Local*Store` (no read-model this device projects), named to match
    /// `CorePersistence.SyncConflictStore`'s own type instead, the same way
    /// `makeSyncEngine()` names `GRDBSyncOutboxStore`/`GRDBSyncCursorStore`
    /// directly rather than through a `local*Store()`-style wrapper.
    func syncConflictStore() -> any SyncConflictStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBSyncConflictStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local sync conflict database; falling back to an in-memory store.")
            return InMemorySyncConflictStore()
        }
    }

    /// The outbox, for reading rather than draining.
    ///
    /// `makeSyncEngine()` builds its own `GRDBSyncOutboxStore` and keeps it
    /// private, which is right for the engine but leaves nothing able to
    /// answer "how much is waiting" — the number the console status strip
    /// shows. Opened per call for the same profile-switch-safety reason every
    /// store above gives.
    func syncOutboxStore() -> any SyncOutboxStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBSyncOutboxStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local sync outbox; reporting an empty queue.")
            return InMemorySyncOutboxStore()
        }
    }

    /// The same identifier `localGardenStore()` opens the on-disk database
    /// by, also used to tag every garden outbox operation's `profileId`
    /// (P5-IOS-02). That field is local bookkeeping only — the contract's
    /// `SyncOperation` has no profile field; the server fills the
    /// authenticated caller's profile itself
    /// (`packages/api-contracts/openapi.yaml`, `SyncOperation`'s own
    /// description) — so reusing this client-local scoping identifier here,
    /// rather than the application profile ID this client never fetches
    /// directly, does not create a wire-format mismatch.
    func currentProfileIdentifier() -> String {
        sessionObserver.currentFirebaseUid ?? "signed-out"
    }
}
