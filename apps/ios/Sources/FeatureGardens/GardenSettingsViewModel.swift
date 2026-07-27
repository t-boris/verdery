import CoreDomain
import CoreLocalization
import CoreNetworking
import Observation

/// View model for a single garden's settings: rename, archive, and request
/// deletion. Owner-only commands are hidden for a non-owner — the server
/// enforces the same restriction independently, so hiding them here is a
/// usability choice, not the security boundary.
///
/// Source: implementation-plan.md work packages P2-IOS-01, P2-SEC-01.
@MainActor
@Observable
public final class GardenSettingsViewModel {
    public private(set) var state: GardenSettingsViewState = .loading
    public var editedName: String = ""
    public private(set) var isSubmitting = false
    public private(set) var actionErrorMessage: String?
    /// Set once deletion has been requested, so the view can navigate back.
    public private(set) var didRequestDeletion = false
    /// Set once `load()` discovers this profile's own access to the garden
    /// was revoked (P9A-SYNC-01's tombstone reaching this device, or simply
    /// this screen's own next network call after some other revocation
    /// producer ran) — see `load()`'s own doc comment on the `garden.not_found`
    /// branch. The view offers an explicit way back to the gardens list
    /// rather than auto-dismissing, so the reader sees why they left rather
    /// than experiencing what would otherwise look like a random pop.
    public private(set) var didLoseAccess = false

    /// Exposed so `GardenSettingsView` can build a `GardenMapEditorRoute`
    /// without this view model growing a second responsibility of its own —
    /// the map editor is a whole separate feature, reached through the
    /// application router (see `AppComposition/RootScene.swift`), not
    /// something this view model constructs or navigates to itself.
    public let gardenId: String
    private let listGardens: ListGardens
    private let getGarden: GetGarden
    private let renameGarden: RenameGarden
    private let archiveGarden: ArchiveGarden
    private let requestGardenDeletion: RequestGardenDeletion
    private let strings: LocalizedStrings

    private var currentGarden: Garden?
    /// Set once a rename/archive/deletion request commits locally this
    /// session — see `GardensListViewModel.summary(for:)`'s doc comment for
    /// why this status is session-scoped rather than durable. Also guards
    /// `load()` from re-applying a fresh `GetGarden` network response: while
    /// this is `true`, that response is necessarily stale (it reflects the
    /// server's state from before this pilot stage's still-unpushed local
    /// mutation), so applying it would revert the screen to a state the user
    /// already changed.
    private var isSavedLocally = false

    public init(
        gardenId: String,
        listGardens: ListGardens,
        getGarden: GetGarden,
        renameGarden: RenameGarden,
        archiveGarden: ArchiveGarden,
        requestGardenDeletion: RequestGardenDeletion,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.listGardens = listGardens
        self.getGarden = getGarden
        self.renameGarden = renameGarden
        self.archiveGarden = archiveGarden
        self.requestGardenDeletion = requestGardenDeletion
        self.strings = strings
    }

    public var title: String { strings(.gardensSettingsTitle) }
    public var renameFieldLabel: String { strings(.gardensCreateNameLabel) }
    public var renameSubmitTitle: String { strings(.gardensRenameSubmit) }
    public var archiveTitle: String { strings(.gardensArchive) }
    public var requestDeletionTitle: String { strings(.gardensRequestDeletion) }
    public var openTodayTitle: String { strings(.gardensOpenToday) }
    public var openMapEditorTitle: String { strings(.gardensOpenMapEditor) }
    public var openPlanUploadTitle: String { strings(.gardensOpenPlanUpload) }
    public var openPlantsTitle: String { strings(.gardensOpenPlants) }
    public var openObservationsTitle: String { strings(.gardensOpenObservations) }
    public var openTasksTitle: String { strings(.gardensOpenTasks) }
    public var openSyncConflictsTitle: String { strings(.gardensOpenSyncConflicts) }
    public var openCollaboratorsTitle: String { strings(.collaborationTitle) }
    /// The `navigationCard` title reaching `GardenContextQualityRoute`
    /// (P9D-UX-01) — resolved from `GardenContextLocalizationKey`, the same
    /// key set `ContextQualityViewModel` itself reads, so the card and the
    /// screen it opens read identically.
    public var openContextQualityTitle: String { strings(.contextQualityOpenTitle) }
    public var backToGardensTitle: String { strings(.collaborationRevokedAccessBackToGardens) }
    public var serviceHealthTitle: String { strings(.healthTitle) }
    public var manageTitle: String { strings(.gardensManageTitle) }
    public var archiveConfirmMessage: String { strings(.gardensArchiveConfirm) }
    public var requestDeletionConfirmMessage: String { strings(.gardensRequestDeletionConfirm) }
    public var cancelTitle: String { strings(.gardensCreateCancel) }
    public var switchGardenTitle: String { strings(.shellSwitchGarden) }

    public func load() async {
        var hadCachedResult = false

        if let cached = try? await listGardens.cached(),
            let garden = cached.first(where: { $0.id == gardenId })
        {
            apply(garden)
            hadCachedResult = true
        } else {
            state = .loading
        }

        do {
            let fetched = try await getGarden(gardenId: gardenId)
            if !isSavedLocally {
                apply(fetched)
            }
        } catch let error as APIGatewayError {
            // `garden.not_found` is the same concealment `GetGarden` uses for
            // a garden that never existed AND for one this profile's active
            // membership was just revoked from — see
            // `identity-and-authorization.md`, section "9.1 Implemented
            // garden evaluation". This screen is reachable only by
            // navigating from a garden this profile already had in its own
            // list, so that ambiguity resolves in practice: revocation is
            // the honest reading, always — unlike every other failure below,
            // this one must NOT be swallowed just because `hadCachedResult`
            // is `true`. Before this fix, a garden revoked mid-session left
            // this screen showing its last-cached summary forever, with no
            // indication anything had changed — exactly the "stale UI"
            // P9A-IOS-01 asks this case to avoid.
            if isAccessRevoked(error) {
                didLoseAccess = true
                state = .failed(message: strings(.collaborationRevokedAccessMessage))
            } else if !hadCachedResult {
                state = .failed(message: message(for: error))
            }
        } catch {
            if !hadCachedResult {
                state = .failed(message: strings(.serverUnexpected))
            }
        }
    }

    /// Whether `error` is `GetGarden`'s `garden.not_found` — the access-
    /// revocation reading described above.
    ///
    /// Source: packages/api-contracts/src/index.ts, `GardenErrorCode.NotFound`.
    private func isAccessRevoked(_ error: APIGatewayError) -> Bool {
        guard case let .service(body, statusCode, _) = error else { return false }
        return statusCode == 404 && body.code == "garden.not_found"
    }

    public func apply(_ garden: Garden) {
        currentGarden = garden
        editedName = garden.name
        state = .loaded(
            GardenSettingsSummary(
                name: garden.name,
                lifecycleState: garden.lifecycleState,
                callerRole: garden.callerRole,
                lifecycleLabel: lifecycleLabel(for: garden.lifecycleState),
                roleLabel: roleLabel(for: garden.callerRole),
                isOwner: garden.callerRole == .owner,
                isActive: garden.lifecycleState == .active,
                revision: garden.revision,
                syncStatusLabel: isSavedLocally ? strings(.gardensSavedLocally) : nil
            )
        )
    }

    public func submitRename() async {
        guard let garden = currentGarden else { return }
        let name = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != garden.name else { return }

        await perform { [self] in
            let result = try await renameGarden(gardenId: gardenId, name: name, expectedRevision: garden.revision)
            isSavedLocally = true
            return result
        }
    }

    public func archive() async {
        guard let garden = currentGarden else { return }

        await perform { [self] in
            let result = try await archiveGarden(gardenId: gardenId, expectedRevision: garden.revision)
            isSavedLocally = true
            return result
        }
    }

    public func requestDeletion() async {
        guard let garden = currentGarden else { return }

        await perform { [self] in
            let result = try await requestGardenDeletion(
                gardenId: gardenId,
                expectedRevision: garden.revision
            )
            isSavedLocally = true
            didRequestDeletion = true
            return result
        }
    }

    private func perform(_ action: () async throws -> Garden) async {
        isSubmitting = true
        actionErrorMessage = nil
        defer { isSubmitting = false }

        do {
            let garden = try await action()
            apply(garden)
        } catch let error as GardenCommandError {
            actionErrorMessage = message(for: error)
        } catch let error as APIGatewayError {
            actionErrorMessage = message(for: error)
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    private func lifecycleLabel(for state: GardenLifecycleState) -> String {
        switch state {
        case .active: strings(.gardensLifecycleActive)
        case .archived: strings(.gardensLifecycleArchived)
        case .deletionRequested: strings(.gardensLifecycleDeletionRequested)
        }
    }

    private func roleLabel(for role: GardenRole) -> String {
        switch role {
        case .owner: strings(.gardensRoleOwner)
        case .editor: strings(.gardensRoleEditor)
        case .viewer: strings(.gardensRoleViewer)
        }
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }

    private func message(for failure: GardenCommandError) -> String {
        switch failure {
        case .invalidName:
            strings(.gardensNameRequired)
        case .localRecordNotFound, .payloadEncodingFailed, .conflictResolutionPayloadMalformed:
            strings(.serverUnexpected)
        }
    }
}
