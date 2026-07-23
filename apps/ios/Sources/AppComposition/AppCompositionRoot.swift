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
            createGarden: CreateGarden(gateway: gardenGateway, localStore: store),
            strings: strings
        )
    }

    public func makeGardenSettingsViewModel(gardenId: String) -> GardenSettingsViewModel {
        let store = localGardenStore()

        return GardenSettingsViewModel(
            gardenId: gardenId,
            listGardens: ListGardens(gateway: gardenGateway, localStore: store),
            getGarden: GetGarden(gateway: gardenGateway, localStore: store),
            renameGarden: RenameGarden(gateway: gardenGateway, localStore: store),
            archiveGarden: ArchiveGarden(gateway: gardenGateway, localStore: store),
            requestGardenDeletion: RequestGardenDeletion(gateway: gardenGateway, localStore: store),
            strings: strings
        )
    }

    public func makeMapEditorViewModel(gardenId: String) -> MapEditorViewModel {
        MapEditorViewModel(
            gardenId: gardenId,
            loadGardenMap: LoadGardenMap(gateway: mapGateway),
            submitMapCommand: SubmitMapCommand(gateway: mapGateway),
            strings: strings
        )
    }

    public func makePlantsHomeViewModel(gardenId: String) -> PlantsHomeViewModel {
        PlantsHomeViewModel(
            gardenId: gardenId,
            addPlant: AddPlant(gateway: plantGateway),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: plantGateway),
            strings: strings
        )
    }

    public func makePlantDetailViewModel(gardenId: String, plantId: String) -> PlantDetailViewModel {
        PlantDetailViewModel(
            gardenId: gardenId,
            plantId: plantId,
            getPlant: GetPlant(gateway: plantGateway),
            updatePlantDetails: UpdatePlantDetails(gateway: plantGateway),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(gateway: plantGateway),
            setPlantStatus: SetPlantStatus(gateway: plantGateway),
            movePlant: MovePlant(gateway: plantGateway),
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
        let profileIdentifier = sessionObserver.currentFirebaseUid ?? "signed-out"

        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBGardenStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local garden database; falling back to an in-memory store.")
            return InMemoryGardenStore()
        }
    }
}
