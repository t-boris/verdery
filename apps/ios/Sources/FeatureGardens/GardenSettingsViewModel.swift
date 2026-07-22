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

    private let gardenId: String
    private let listGardens: ListGardens
    private let getGarden: GetGarden
    private let renameGarden: RenameGarden
    private let archiveGarden: ArchiveGarden
    private let requestGardenDeletion: RequestGardenDeletion
    private let strings: LocalizedStrings

    private var currentGarden: Garden?

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
            apply(try await getGarden(gardenId: gardenId))
        } catch let error as APIGatewayError {
            if !hadCachedResult {
                state = .failed(message: message(for: error))
            }
        } catch {
            if !hadCachedResult {
                state = .failed(message: strings(.serverUnexpected))
            }
        }
    }

    public func apply(_ garden: Garden) {
        currentGarden = garden
        editedName = garden.name
        state = .loaded(
            GardenSettingsSummary(
                name: garden.name,
                lifecycleLabel: lifecycleLabel(for: garden.lifecycleState),
                roleLabel: roleLabel(for: garden.callerRole),
                isOwner: garden.callerRole == .owner,
                isActive: garden.lifecycleState == .active,
                revision: garden.revision
            )
        )
    }

    public func submitRename() async {
        guard let garden = currentGarden else { return }
        let name = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != garden.name else { return }

        await perform { [self] in
            try await renameGarden(gardenId: gardenId, name: name, expectedRevision: garden.revision)
        }
    }

    public func archive() async {
        guard let garden = currentGarden else { return }

        await perform { [self] in
            try await archiveGarden(gardenId: gardenId, expectedRevision: garden.revision)
        }
    }

    public func requestDeletion() async {
        guard let garden = currentGarden else { return }

        await perform { [self] in
            let result = try await requestGardenDeletion(
                gardenId: gardenId,
                expectedRevision: garden.revision
            )
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
}
