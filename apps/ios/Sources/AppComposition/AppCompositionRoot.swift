import CoreAuthentication
import CoreLocalization
import CoreNetworking
import CoreObservability
import FeatureAuthentication
import FeatureGardens
import FeatureHealth
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

    /// Scoped by Firebase UID; see `GardenDatabase` for why that, not the
    /// application profile ID, is what "per-profile" means on this client.
    ///
    /// Opened fresh per call rather than cached: SQLite connections are cheap
    /// to open relative to a screen's lifetime, and this avoids holding a
    /// database handle open for a profile that has since signed out.
    private func localGardenStore() -> any LocalGardenStore {
        let profileIdentifier = sessionObserver.currentFirebaseUid ?? "signed-out"

        do {
            let dbQueue = try GardenDatabase.open(profileIdentifier: profileIdentifier)
            return GRDBGardenStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local garden database; falling back to an in-memory store.")
            return InMemoryGardenStore()
        }
    }
}
