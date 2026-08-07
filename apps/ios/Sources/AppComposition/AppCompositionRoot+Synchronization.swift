import CoreNetworking
import CorePersistence
import CoreSynchronization
import FeatureGardens
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureSyncConflicts
import FeatureTasks
import Foundation

/// Synchronization wiring, split out of `AppCompositionRoot.swift` when that
/// file reached this repository's 600-line ceiling.
///
/// The stored `syncStatusCenter` stays in the main file — Swift does not allow
/// a stored property in an extension — but everything it is built from lives
/// here, beside the engine factory whose per-call shape it has to respect.
extension AppCompositionRoot {
    /// One garden's durable sync conflicts screen (P5-CONFLICT-01). Shares
    /// `makeSyncEngine()`'s own "opened fresh per call" reasoning for both
    /// the conflict store and the engine it hands `SyncConflictsViewModel`
    /// as its `ConflictResolvingSyncEngine` — see that method's own doc
    /// comment.
    public func makeSyncConflictsViewModel(gardenId: String) -> SyncConflictsViewModel {
        SyncConflictsViewModel(
            gardenId: gardenId,
            conflictStore: syncConflictStore(),
            engine: makeSyncEngine(),
            strings: strings
        )
    }

    /// The real, network-backed push/pull engine (P5-IOS-03, Stages 5a/5b)
    /// — reads `sync_outbox`/`sync_cursor` for the current profile's
    /// database, pushes and pulls through `syncGateway`, applying each of
    /// the five features' results through its own registered
    /// `SyncRecordApplier`. This is the one place a concrete
    /// `SyncRecordApplier` conformer is named alongside the engine it is
    /// registered with — see `CoreSynchronization.SyncRecordApplier`'s own
    /// doc comment for why that pairing can only happen here.
    ///
    /// Opened fresh per call, matching every `local*Store()` method's own
    /// reasoning (`AppCompositionRoot+LocalStores.swift`): cheap relative
    /// to a call's lifetime, and avoids
    /// holding a database handle open for a profile that has since signed
    /// out. Deliberately still a plain factory, not a stored singleton
    /// (Stage 5b considered and rejected making this a long-lived, cached
    /// instance): every trigger this stage wires
    /// (`RootView`'s scene-phase `.onChange`) calls this fresh each time it
    /// fires, for the same profile-switch-safety reason `local*Store()`
    /// already gives — a cached engine instance bound to whatever profile
    /// was signed in at construction time would keep operating against a
    /// stale `DatabaseQueue`/profile after a sign-out/sign-in as a different
    /// user. One real consequence, noted plainly rather than glossed over:
    /// `RemoteSyncEngine.status` is therefore only observable within one
    /// instance's own call — see that property's own doc comment, and
    /// `SyncEngineStatus`'s, for why wiring it into per-screen UI is this
    /// stage's own deliberately separate follow-up rather than something
    /// this factory shape could serve today anyway.
    public func makeSyncEngine() -> RemoteSyncEngine {
        let profileIdentifier = currentProfileIdentifier()
        let appliers: [any SyncRecordApplier] = [
            GardenSyncRecordApplier(localStore: localGardenStore()),
            MapSyncRecordApplier(localStore: localMapStore()),
            PlantSyncRecordApplier(localStore: localPlantStore()),
            ObservationSyncRecordApplier(localStore: localObservationStore()),
            TaskSyncRecordApplier(localStore: localTaskStore()),
        ]

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return RemoteSyncEngine(
                outboxStore: GRDBSyncOutboxStore(dbQueue: dbQueue),
                conflictStore: GRDBSyncConflictStore(dbQueue: dbQueue),
                // Same `dbQueue` as the outbox/conflict stores immediately
                // above — required for real transaction atomicity between
                // them (`SyncTransactionContext`'s own doc comment): two
                // different `DatabaseQueue` connections to the same SQLite
                // file cannot share one GRDB transaction, so this only works
                // because all three are constructed from this one instance.
                outboxConflictTransaction: GRDBSyncConflictResolutionOutboxTransaction(dbQueue: dbQueue),
                operationResultStore: GRDBSyncOperationResultStore(dbQueue: dbQueue),
                gateway: syncGateway,
                clientInstallationStore: clientInstallationStore,
                cursorStore: GRDBSyncCursorStore(dbQueue: dbQueue),
                appliers: appliers,
                appVersion: Self.currentAppVersion,
                log: log
            )
        } catch {
            log.record(.error, "Could not open the local synchronization database; falling back to an in-memory outbox.")
            return RemoteSyncEngine(
                outboxStore: InMemorySyncOutboxStore(),
                conflictStore: InMemorySyncConflictStore(),
                operationResultStore: InMemorySyncOperationResultStore(),
                gateway: syncGateway,
                clientInstallationStore: clientInstallationStore,
                cursorStore: InMemorySyncCursorStore(),
                appliers: appliers,
                appVersion: Self.currentAppVersion,
                log: log
            )
        }
    }

    /// `CFBundleShortVersionString` is unset for the headless `swift build`/
    /// `swift test` SPM executable (only the Xcode-built app target carries
    /// a real `Info.plist`) — the same "no bundle metadata outside the real
    /// app target" gap `VerderyApp`'s own doc comment notes for
    /// `GoogleService-Info.plist`, so this falls back to a placeholder
    /// rather than failing.
    private static var currentAppVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }
}
