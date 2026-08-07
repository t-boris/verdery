import CoreAuthentication
import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreMediaTransfer
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
import FeatureRecommendations
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

    // `strings`/`gardenGateway`/`collaborationGateway`: module-internal, not
    // `private` — read by `AppCompositionRoot+Collaboration.swift`'s
    // factories (a same-type extension in another file, which `private`, a
    // file scope rather than a type scope, would exclude), the same reason
    // `log`/`authenticationGateway`/`locale` below already are.
    let strings: LocalizedStrings
    private let healthGateway: any HealthGateway
    let gardenGateway: any GardenGateway
    // `let`, not `private let`: read by `AppCompositionRoot+Plants.swift`'s
    // factories, a same-type extension in another file, which `private` (a
    // file scope, not a type scope) would exclude — the same reason
    // `seasonalPlanGateway` below is `let`.
    let mapGateway: any MapGateway
    let plantGateway: any PlantGateway
    /// `let`: read by `AppCompositionRoot+Observations.swift`'s factories,
    /// the same reason `plantGateway` is.
    let observationGateway: any ObservationGateway
    // `let`, not `private let`: read by `AppCompositionRoot+Candidates.swift`'s
    // factories, the same reason `plantGateway` above is `let`.
    let plantCandidateGateway: any PlantCandidateGateway
    /// `let`, not `private let`: a plant's care card reads the garden's
    /// outstanding tasks, and its factory lives in
    /// `AppCompositionRoot+Plants.swift` — a same-type extension in another
    /// file, which `private` (a file scope, not a type scope) would exclude.
    let taskGateway: any TaskGateway
    /// P9A-TASK-01's task-assignment picker is this instance's only consumer
    /// today — see `makeTasksListViewModel(gardenId:)`'s own construction of
    /// `ListGardenMembers`. `FeatureGardens`'s own collaboration-
    /// administration screen (the other half of P9A-IOS-01) is expected to
    /// become a second consumer of this same instance once it lands, not a
    /// reason to construct a second one.
    let collaborationGateway: any CollaborationGateway
    /// Module-internal for the same reason as `taskGateway` above: a plant's
    /// care card reads the garden's undecided suggestions.
    let recommendationGateway: any RecommendationGateway
    /// The garden's stored conditions, read by Today's panel and by a plant's
    /// care card. `let`, not `private let`: also read by
    /// `AppCompositionRoot+Plants.swift`'s factory, a same-type extension in
    /// another file, which `private` (a file scope) would exclude.
    let weatherGateway: any WeatherGateway
    /// The notification inbox, its preferences, and this device's push
    /// channel. `let`: read by `AppCompositionRoot+Notifications.swift`.
    let notificationGateway: any NotificationGateway
    /// Finding an address, and recording where a garden sits.
    let geographyGateway: any GeographyGateway
    // The Seasonal plan and Context quality surfaces (P9D-UX-01) — same
    // scope as `recommendationGateway` immediately above: both are ONLINE,
    // gateway-backed capabilities with no local read-model table (see each
    // gateway's own doc comment). `let`, not `private let`: read by
    // `AppCompositionRoot+SeasonalPlan.swift`'s factories, a same-type
    // extension in another file, which `private` (a file scope, not a type
    // scope) would exclude — the same reason `strings`/`gardenGateway`/
    // `collaborationGateway` above already are `let`.
    let seasonalPlanGateway: any SeasonalPlanGateway
    let gardenContextGateway: any GardenContextGateway
    // `let`, not `private let`: read by `AppCompositionRoot+Synchronization
    // .swift`'s `makeSyncEngine()`, a same-type extension in another file,
    // which `private` (a file scope, not a type scope) would exclude — the
    // same reason `mapGateway`/`plantGateway` above already are `let`.
    let syncGateway: any SyncGateway
    /// The caller's own account — deletion, and withdrawing a deletion.
    /// `let`, not `private let`: read by `AccountEntryPoint.swift`'s factory.
    let accountGateway: any AccountGateway
    /// Taking a copy of your own data. Same scope as `accountGateway`.
    let exportGateway: any ExportGateway
    // `let`, not `private let`: read by `AppCompositionRoot+Plants.swift`'s
    // `makePlantDetailViewModel`, the same reason `mapGateway` above is `let`.
    let mediaGateway: any MediaGateway
    // `let` for the same reason `syncGateway` above is: `makeSyncEngine()`
    // now lives in a same-type extension in another file.
    let clientInstallationStore: any ClientInstallationIdentityStore
    /// This installation's FCM registration token, behind a protocol so no
    /// target above `CoreAuthentication` imports a Firebase SDK.
    let pushTokenProvider: any PushTokenProvider
    /// One per process. Permission and registration are device facts, and iOS
    /// grants a permission prompt exactly once.
    public let pushRegistration: PushRegistrationController
    // Module-internal, not `private`: read by the per-profile store
    // factories in `AppCompositionRoot+LocalStores.swift`, and — for the two
    // below — by the account screen's factory in `AccountEntryPoint.swift`.
    // Both are same-type extensions in other files, which `private` (a file
    // scope, not a type scope) would exclude.
    let log: any DiagnosticLog
    let authenticationGateway: any AuthenticationGateway
    /// The locale the catalogue above was resolved against, kept so the
    /// account screen can name the language it is actually rendering in.
    let locale: Locale
    /// One instance for the app's lifetime — see its own doc comment for why
    /// (P9A-IOS-01). `public` rather than read only through a factory method:
    /// `RootScene`/`GardenTabView` read it directly to decide whether to
    /// present the accept-invitation screen or an ownership-transfer banner.
    public let collaborationSessionState = CollaborationSessionState()

    /// Which orientations are acceptable right now — see
    /// ``OrientationPolicy``. Read by `AppDelegate`, written by the map.
    public let orientationPolicy = OrientationPolicy()

    /// A plant label that has been scanned but not yet opened.
    ///
    /// Recorded here rather than acted on at the parse site because opening it
    /// may first require signing in, or switching to the garden it belongs to
    /// — the same reason a pending invitation token waits in
    /// `collaborationSessionState`.
    public internal(set) var pendingPlantLink: PlantDeepLink?

    /// Called once the shell has opened it, so a stale link cannot re-fire.
    public func clearPendingPlantLink() {
        pendingPlantLink = nil
    }

    /// A tapped notification, waiting for the shell in exactly the same way and
    /// for exactly the same reason: it may need a sign-in or a garden switch
    /// before its destination can be shown.
    public internal(set) var pendingNotificationLink: NotificationDeepLink?

    /// Records a tapped notification's destination.
    public func openNotificationDeepLink(_ deepLink: NotificationDeepLink) {
        pendingNotificationLink = deepLink
    }

    public func clearPendingNotificationLink() {
        pendingNotificationLink = nil
    }

    /// The two synchronization triggers `RootScene` used to document as
    /// missing: reconnection, and an occasional background opportunity.
    /// `lazy` because both need `syncStatusCenter`.
    @ObservationIgnored private lazy var connectivityTrigger = ConnectivityTrigger()
    @ObservationIgnored public private(set) lazy var backgroundSyncScheduler =
        BackgroundSyncScheduler { [unowned self] in
            await self.syncStatusCenter.synchronize()
        }

    /// Starts the triggers that live outside the view tree.
    ///
    /// Registration of the background task must happen before the application
    /// finishes launching, which is why this is called from the entry point's
    /// composition rather than from a screen's `.task`.
    public func startSynchronizationTriggers() {
        backgroundSyncScheduler.register()
        backgroundSyncScheduler.scheduleNext()
        connectivityTrigger.start { [unowned self] in
            Task { await self.syncStatusCenter.synchronize() }
        }
    }

    /// The application-lifetime owner of synchronization status.
    ///
    /// `lazy` because its three closures need `self`, and app-lifetime rather
    /// than per-call because a status nobody holds is a status nobody can
    /// show — which is exactly the gap `SyncEngineStatus` documented. It binds
    /// to a profile rather than to a moment, so the profile-switch safety
    /// `makeSyncEngine()` protects is kept; see ``SyncStatusCenter``.
    public private(set) lazy var syncStatusCenter = SyncStatusCenter(
        makeEngine: { [unowned self] in self.makeSyncEngine() },
        makeOutboxStore: { [unowned self] in self.syncOutboxStore() },
        currentProfileIdentifier: { [unowned self] in self.currentProfileIdentifier() }
    )

    /// The real background-capable upload transport (P6-IOS-01) —
    /// constructed eagerly, here in `init`, not lazily on first screen
    /// visit: architecture/ios-application-design.md, section
    /// "13. Media Transfer" requires surviving app suspension AND
    /// termination, and a background `URLSession` must exist as early in
    /// the launch sequence as possible to reliably reconnect to whatever
    /// the OS kept alive — `VerderyApp`'s own `AppDelegate` hands this
    /// instance's `handleBackgroundURLSessionEvents` the completion handler
    /// the OS gives `application(_:handleEventsForBackgroundURLSession:
    /// completionHandler:)`, which can fire immediately after launch if the
    /// OS relaunched the app specifically to deliver a finished transfer.
    private let mediaUploadTransport: URLSessionBackgroundUploadTransport
    /// The single, app-lifetime `MediaUploadCoordinator` instance — NOT a
    /// per-call factory like `makeSyncEngine()` below and every
    /// `local*Store()` method (`AppCompositionRoot+LocalStores.swift`), for
    /// two combined reasons neither of which allows it here: (1)
    /// `mediaUploadTransport`'s one background `URLSession` may only have
    /// one delegate/one live event stream — a second coordinator instance
    /// subscribing to the same `AsyncStream` would race the first for
    /// events, not receive its own copy (`AsyncStream` has single-consumer
    /// semantics); (2) unlike a request-scoped store, this coordinator owns
    /// a genuinely long-lived subscription task, so "opened fresh per call"
    /// would leak one abandoned subscription per screen visit.
    ///
    /// Known, deliberate limitation, not an oversight: `transferStore`
    /// below is resolved from `currentProfileIdentifier()` ONCE, at this
    /// `init`, not re-resolved on a later sign-in/sign-out within the same
    /// process — every other `local*Store()` method re-reads
    /// `currentProfileIdentifier()` per call specifically to stay correct
    /// across a profile switch, which this type cannot do without either
    /// tearing down and rebuilding the background session (losing any
    /// in-flight OS-tracked transfer) or giving `MediaTransfer` rows their
    /// own profile column and a runtime rebind path — both real, scoped
    /// follow-ups, not attempted here. In practice this reads correctly for
    /// the overwhelmingly common case (a single signed-in profile per
    /// device, already signed in at cold launch): `AuthenticationSessionObserver`
    /// restores a persisted Firebase session synchronously at construction
    /// when one exists (see that type's own doc comment) — see this stage's
    /// own report for the account-switch edge case this leaves open.
    // `let`, not `private let`: the account-deletion teardown in
    // `AccountEntryPoint.swift` has to reach it, and that is a same-type
    // extension in another file.
    let mediaUploadCoordinator: MediaUploadCoordinator
    /// Downloaded media, keyed by media id. App-lifetime because its whole
    /// purpose is surviving a signed URL's expiry — see ``MediaImageCache``.
    public let mediaImageCache = MediaImageCache()

    /// Fixed, stable identifier for the one background upload session this
    /// process ever creates — must never change between app versions (the
    /// OS correlates a relaunch's `handleEventsForBackgroundURLSession`
    /// callback to the session that started the transfer by this string
    /// alone).
    public static let mediaBackgroundSessionIdentifier = "com.verdery.app.media-upload"

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
        self.locale = locale
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
        // Plant candidates (P11-IOS-01) — same scope as every Phase 4/5
        // gateway above, and deliberately online-only: see
        // `CoreNetworking.PlantCandidateGateway`'s own doc comment.
        self.plantCandidateGateway = URLSessionPlantCandidateGateway(
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
        // Same scope as every Phase 4/5 gateway above — P9A-API-01's
        // operational-collaboration surface.
        self.collaborationGateway = URLSessionCollaborationGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.geographyGateway = URLSessionGeographyGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.notificationGateway = URLSessionNotificationGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Weather is garden context: an ordinary `viewGarden` read of what
        // the scheduled sweep already fetched, never a call to a provider.
        self.weatherGateway = URLSessionWeatherGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // The Today recommendation surface (P7-IOS-01) authenticates and
        // classifies traffic the same way every Phase 4+ gateway above does.
        self.recommendationGateway = URLSessionRecommendationGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Same scope as every Phase 4/5 gateway above — P9D-UX-01's
        // Seasonal plan and Context quality surfaces.
        self.seasonalPlanGateway = URLSessionSeasonalPlanGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.gardenContextGateway = URLSessionGardenContextGateway(
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
        self.exportGateway = URLSessionExportGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.accountGateway = URLSessionAccountGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        // Same scope as every Phase 4/5 gateway above. Never used to
        // transfer the media bytes themselves — only registration/
        // completion/status/access, per `MediaGateway`'s own doc comment.
        self.mediaGateway = URLSessionMediaGateway(
            configuration: configuration,
            session: session,
            authTokenProvider: tokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
        self.authenticationGateway = FirebaseAuthenticationGateway(
            emailSignInContinueURL: AppEnvironment.emailSignInContinueURL
        )
        self.sessionObserver = AuthenticationSessionObserver()

        // Before the first window. `UITabBarAppearance` is a proxy, so a tab
        // bar built before this runs keeps the system's grey chrome; and it
        // registers the bundled typefaces, which the tab labels are set in.
        // Here rather than in the entry point so `VerderyApp` keeps depending
        // on this module alone.
        ConsoleAppearance.install()

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

        // The real provider on a device; a no-op on the headless macOS build
        // and in tests, where no APNs exists and absence of a token is an
        // ordinary state rather than a failure.
        let pushTokens: any PushTokenProvider = FirebasePushTokenProvider()
        self.pushTokenProvider = pushTokens
        self.pushRegistration = PushRegistrationController(
            gateway: self.notificationGateway,
            installationStore: self.clientInstallationStore,
            strings: strings,
            currentPushToken: { await pushTokens.currentPushToken() }
        )

        // Eager, app-lifetime construction — see `mediaUploadTransport`'s
        // and `mediaUploadCoordinator`'s own doc comments above for why.
        // `currentProfileIdentifier()` is safe to call here: `sessionObserver`
        // (the only property it reads) is already assigned above.
        self.mediaUploadTransport = URLSessionBackgroundUploadTransport(
            sessionIdentifier: Self.mediaBackgroundSessionIdentifier
        )

        let mediaTransferStore: any MediaTransferStore
        do {
            let dbQueue = try LocalDatabase.open(profileIdentifier: sessionObserver.currentFirebaseUid ?? "signed-out")
            mediaTransferStore = GRDBMediaTransferStore(dbQueue: dbQueue)
        } catch {
            log.record(.error, "Could not open the local media transfer database; falling back to an in-memory store.")
            mediaTransferStore = InMemoryMediaTransferStore()
        }
        self.mediaUploadCoordinator = MediaUploadCoordinator(
            fileStore: FileManagerLocalMediaFileStore(),
            transferStore: mediaTransferStore,
            gateway: mediaGateway,
            uploadTransport: mediaUploadTransport,
            log: log
        )
        let coordinatorToStart = mediaUploadCoordinator
        Task { await coordinatorToStart.start() }
    }

    public func makeServiceHealthViewModel() -> ServiceHealthViewModel {
        ServiceHealthViewModel(
            checkServiceHealth: CheckServiceHealth(gateway: healthGateway),
            strings: strings
        )
    }

    /// The catalogue, for the composition layer's own shell chrome.
    ///
    /// `RootView` and `GardenTabView` are views this layer owns rather than a
    /// feature's, so they have no view model to read their strings from; the
    /// tab titles still have to be keyed and translated like every other
    /// user-visible string.
    public var localizedStrings: LocalizedStrings { strings }

    public func makeSignInViewModel() -> SignInViewModel {
        SignInViewModel(authenticationGateway: authenticationGateway, strings: strings)
    }

    // `handleIncomingURL(_:)` — routes a URL the OS delivered to the app,
    // including this app's own `verdery://` collaboration deep links — lives
    // in `AppCompositionRoot+DeepLinks.swift`, split out purely to keep this
    // file under this repository's 600-line rule, the same
    // `AppCompositionRoot+LocalStores.swift`/`AccountEntryPoint.swift`
    // precedent.

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
            // P6-PLAN iOS parity: the plan-background panel's document list
            // and the underlay's display-image resolution, both over the
            // one shared media gateway.
            listGardenPlanMedia: ListGardenPlanMedia(gateway: mediaGateway),
            loadPlanBackgroundImage: LoadPlanBackgroundImage(gateway: mediaGateway),
            strings: strings
        )
    }

    /// Forwards the app delegate's own `application(_:
    /// handleEventsForBackgroundURLSession:completionHandler:)` to
    /// `mediaUploadTransport` — see `VerderyApp`'s own `AppDelegate` for the
    /// UIKit-side half of this handoff. A session identifier that does not
    /// match this process's own single background session (should not
    /// happen in practice — this app creates exactly one — but a defensive
    /// check costs nothing) calls the handler immediately rather than
    /// hanging it.
    public func handleBackgroundURLSessionEvents(identifier: String, completionHandler: @escaping @Sendable () -> Void) {
        guard identifier == Self.mediaBackgroundSessionIdentifier else {
            completionHandler()
            return
        }

        Task { await mediaUploadTransport.handleBackgroundSessionEvents(completionHandler: completionHandler) }
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
            assignTask: AssignTask(gateway: taskGateway, localStore: store),
            getTaskActivity: GetTaskActivity(gateway: taskGateway),
            listGardenMembers: ListGardenMembers(gateway: collaborationGateway),
            strings: strings
        )
    }

    /// One garden's Today recommendation screen (P7-IOS-01). No local store
    /// and no profile id: every use case here is online, gateway-backed by
    /// deliberate decision — see `FeatureRecommendations.TodayUseCases`'s
    /// own doc comment.

}
