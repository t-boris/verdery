import CoreAuthentication
import CoreLocalization
import CoreNetworking
import CoreObservability
import CorePersistence
import CoreSynchronization
import FeatureAuthentication
import FeatureGardens
import FeatureHealth
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureSyncConflicts
import FeatureTasks
import Foundation

/// The single place where adapters are constructed and injected.
///
/// Nothing else in the application resolves a dependency: features receive
/// theirs through explicit initializers, which is what keeps them independently
/// testable and keeps URLSession out of view code.
///
/// Source: architecture/ios-application-design.md, sections "5.4 Infrastructure"
/// and "21. Dependency Rules".
@MainActor
public final class AppCompositionRoot {
    public let sessionObserver: AuthenticationSessionObserver

    private let strings: LocalizedStrings
    private let healthGateway: any HealthGateway
    private let gardenGateway: any GardenGateway
    private let mapGateway: any MapGateway
    private let plantGateway: any PlantGateway
    private let observationGateway: any ObservationGateway
    private let taskGateway: any TaskGateway
    private let syncGateway: any SyncGateway
    private let authenticationGateway: any AuthenticationGateway
    private let clientInstallationStore: any ClientInstallationIdentityStore
    private let log: any DiagnosticLog

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        locale: Locale = .autoupdatingCurrent,
        log: any DiagnosticLog = SystemDiagnosticLog(
            subsystem: "com.verdery.app",
            category: "networking"
        )
    ) {
        self.strings = LocalizedStrings(locale: locale)
        self.log = log

        let tokenProvider = FirebaseAuthTokenProvider()
        // App Check follows the same scope as the auth token: only the
        // garden gateway authenticates, so only it needs a traffic-
        // classification signal. `HealthGateway` stays fully unauthenticated.
        let appCheckTokenProvider = FirebaseAppCheckTokenProvider()

        self.healthGateway = URLSessionHealthGateway(
            configuration: configuration,
            session: session,
            log: log
        )
        self.gardenGateway = URLSessionGardenGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Same scope as the garden gateway: the map editor authenticates and
        // classifies traffic exactly the way garden lifecycle operations do.
        self.mapGateway = URLSessionMapGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Plants, observations, and tasks (Phase 4) all authenticate and
        // classify traffic the same way garden lifecycle operations do.
        self.plantGateway = URLSessionPlantGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.observationGateway = URLSessionObservationGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.taskGateway = URLSessionTaskGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Same scope as every Phase 4/5 gateway above.
        self.syncGateway = URLSessionSyncGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.authenticationGateway = FirebaseAuthenticationGateway()
        self.sessionObserver = AuthenticationSessionObserver()

        // Device-scoped, not per-profile — see that type's own doc comment
        // for why. Constructed once here, not per `makeSyncEngine()` call,
        // since it depends on nothing profile-specific and a fresh
        // `InMemoryClientInstallationIdentityStore` fallback should not be
        // re-created (and so re-randomized) on every call either.
        if let fileStore = try? FileClientInstallationIdentityStore() {
            self.clientInstallationStore = fileStore
        } else {
            log.record(.error, "Could not open the client installation id file; falling back to an in-memory store.")
            self.clientInstallationStore = InMemoryClientInstallationIdentityStore()
        }
    }

    public func makeServiceHealthViewModel() -> ServiceHealthViewModel {
        ServiceHealthViewModel(
            checkServiceHealth: CheckServiceHealth(gateway: healthGateway),
            strings: strings
        )
    }

    public func makeSignInViewModel() -> SignInViewModel {
        SignInViewModel(authenticationGateway: authenticationGateway, strings: strings)
    }

    public func makeGardensListViewModel() -> GardensListViewModel {
        let store = localGardenStore()

        return GardensListViewModel(
            listGardens: ListGardens(gateway: gardenGateway, localStore: store),
            createGarden: CreateGarden(localStore: store, profileId: currentProfileIdentifier()),
            strings: strings
        )
    }

    public func makeGardenSettingsViewModel(gardenId: String) -> GardenSettingsViewModel {
        let store = localGardenStore()
        let profileId = currentProfileIdentifier()

        return GardenSettingsViewModel(
            gardenId: gardenId,
            listGardens: ListGardens(gateway: gardenGateway, localStore: store),
            getGarden: GetGarden(gateway: gardenGateway, localStore: store),
            renameGarden: RenameGarden(localStore: store, profileId: profileId),
            archiveGarden: ArchiveGarden(localStore: store, profileId: profileId),
            requestGardenDeletion: RequestGardenDeletion(localStore: store, profileId: profileId),
            strings: strings
        )
    }

    public func makeMapEditorViewModel(gardenId: String) -> MapEditorViewModel {
        let store = localMapStore()
        let profileId = currentProfileIdentifier()

        return MapEditorViewModel(
            gardenId: gardenId,
            loadGardenMap: LoadGardenMap(gateway: mapGateway, localStore: store),
            submitMapCommand: SubmitMapCommand(gateway: mapGateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: store, profileId: profileId),
            strings: strings
        )
    }

    public func makePlantsHomeViewModel(gardenId: String) -> PlantsHomeViewModel {
        let store = localPlantStore()
        let profileId = currentProfileIdentifier()

        return PlantsHomeViewModel(
            gardenId: gardenId,
            addPlant: AddPlant(localStore: store, profileId: profileId),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: plantGateway),
            strings: strings
        )
    }

    public func makePlantDetailViewModel(gardenId: String, plantId: String) -> PlantDetailViewModel {
        let store = localPlantStore()
        let profileId = currentProfileIdentifier()

        return PlantDetailViewModel(
            gardenId: gardenId,
            plantId: plantId,
            getPlant: GetPlant(gateway: plantGateway, localStore: store),
            updatePlantDetails: UpdatePlantDetails(localStore: store, profileId: profileId),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(localStore: store, profileId: profileId),
            setPlantStatus: SetPlantStatus(localStore: store, profileId: profileId),
            movePlant: MovePlant(localStore: store, profileId: profileId),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: plantGateway),
            strings: strings
        )
    }

    public func makeObservationsTimelineViewModel(gardenId: String) -> ObservationsTimelineViewModel {
        let store = localObservationStore()
        let profileId = currentProfileIdentifier()

        return ObservationsTimelineViewModel(
            gardenId: gardenId,
            recordObservation: RecordObservation(localStore: store, profileId: profileId),
            listObservationsForGarden: ListObservationsForGarden(gateway: observationGateway, localStore: store),
            listObservationsForPlant: ListObservationsForPlant(gateway: observationGateway),
            correctObservation: CorrectObservation(localStore: store, profileId: profileId),
            strings: strings
        )
    }

    public func makeTasksListViewModel(gardenId: String) -> TasksListViewModel {
        let store = localTaskStore()
        let profileId = currentProfileIdentifier()

        return TasksListViewModel(
            gardenId: gardenId,
            createManualTask: CreateManualTask(localStore: store, profileId: profileId),
            listTasksForGarden: ListTasksForGarden(gateway: taskGateway, localStore: store),
            editTask: EditTask(localStore: store, profileId: profileId),
            rescheduleTask: RescheduleTask(localStore: store, profileId: profileId),
            completeTask: CompleteTask(localStore: store, profileId: profileId),
            dismissTask: DismissTask(localStore: store, profileId: profileId),
            skipTask: SkipTask(localStore: store, profileId: profileId),
            deleteTask: DeleteTask(localStore: store, profileId: profileId),
            strings: strings
        )
    }

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
    /// reasoning below: cheap relative to a call's lifetime, and avoids
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

    /// Scoped by Firebase UID; see `CorePersistence.LocalDatabase` for why
    /// that, not the application profile ID, is what "per-profile" means on
    /// this client.
    ///
    /// Opened fresh per call rather than cached: SQLite connections are cheap
    /// to open relative to a screen's lifetime, and this avoids holding a
    /// database handle open for a profile that has since signed out.
    private func localGardenStore() -> any LocalGardenStore {
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
    private func localMapStore() -> any LocalMapStore {
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
    private func localPlantStore() -> any LocalPlantStore {
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
    private func localObservationStore() -> any LocalObservationStore {
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
    private func localTaskStore() -> any LocalTaskStore {
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
    private func syncConflictStore() -> any SyncConflictStore {
        let profileIdentifier = currentProfileIdentifier()

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBSyncConflictStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local sync conflict database; falling back to an in-memory store.")
            return InMemorySyncConflictStore()
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
    private func currentProfileIdentifier() -> String {
        sessionObserver.currentFirebaseUid ?? "signed-out"
    }
}
