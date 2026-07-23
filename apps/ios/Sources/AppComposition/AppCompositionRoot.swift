import CoreAuthentication
import CoreLocalization
import CoreNetworking
import CoreObservability
import CorePersistence
import FeatureAuthentication
import FeatureGardens
import FeatureHealth
import FeatureMap
import FeatureObservations
import FeaturePlants
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
    private let authenticationGateway: any AuthenticationGateway
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
        self.authenticationGateway = FirebaseAuthenticationGateway()
        self.sessionObserver = AuthenticationSessionObserver()
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
        ObservationsTimelineViewModel(
            gardenId: gardenId,
            recordObservation: RecordObservation(gateway: observationGateway),
            listObservationsForGarden: ListObservationsForGarden(gateway: observationGateway),
            listObservationsForPlant: ListObservationsForPlant(gateway: observationGateway),
            correctObservation: CorrectObservation(gateway: observationGateway),
            strings: strings
        )
    }

    public func makeTasksListViewModel(gardenId: String) -> TasksListViewModel {
        TasksListViewModel(
            gardenId: gardenId,
            createManualTask: CreateManualTask(gateway: taskGateway),
            listTasksForGarden: ListTasksForGarden(gateway: taskGateway),
            editTask: EditTask(gateway: taskGateway),
            rescheduleTask: RescheduleTask(gateway: taskGateway),
            completeTask: CompleteTask(gateway: taskGateway),
            dismissTask: DismissTask(gateway: taskGateway),
            skipTask: SkipTask(gateway: taskGateway),
            deleteTask: DeleteTask(gateway: taskGateway),
            strings: strings
        )
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
