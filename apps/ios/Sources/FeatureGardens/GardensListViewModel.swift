import CoreDomain
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the garden list and inline create form.
///
/// Loading shows the local read model immediately, before the network
/// request that follows it resolves — the whole reason `P2-IOS-01` asks for
/// a local store rather than only an in-memory list.
///
/// Source: architecture/ios-application-design.md, sections "5.1 Presentation"
/// and "21. Dependency Rules"; implementation-plan.md work package P2-IOS-01.
@MainActor
@Observable
public final class GardensListViewModel {
    public private(set) var state: GardensListViewState = .loading
    public var newGardenName: String = ""
    public private(set) var isCreating = false
    public private(set) var createErrorMessage: String?

    private let listGardens: ListGardens
    private let createGarden: CreateGarden
    private let strings: LocalizedStrings

    /// Garden IDs created locally during the current session whose outbox
    /// operation this pilot stage (P5-IOS-02) cannot yet confirm pushed —
    /// `CoreSynchronization.LocalOnlySyncEngine` never actually synchronizes
    /// anything yet. Deliberately session-scoped rather than derived from a
    /// persisted, outbox-backed query: the full status vocabulary
    /// (architecture/ios-application-design.md, section "8. Synchronization
    /// Integration" — `Waiting for connectivity`, `Synchronizing`,
    /// `Synchronized`, `Requires attention`, `Upload pending`) needs a real
    /// `SyncEngine` to report through, which is P5-IOS-03's job. This is the
    /// minimal, honest slice: "saved locally, not yet synchronized"
    /// immediately after the local transaction that made it true, and for as
    /// long as this screen instance's session lasts.
    private var locallySavedGardenIds: Set<String> = []

    public init(listGardens: ListGardens, createGarden: CreateGarden, strings: LocalizedStrings) {
        self.listGardens = listGardens
        self.createGarden = createGarden
        self.strings = strings
    }

    public var title: String { strings(.gardensTitle) }
    public var emptyMessage: String { strings(.gardensEmpty) }
    public var loadingMessage: String { strings(.gardensLoading) }
    public var retryTitle: String { strings(.gardensRetry) }
    public var createTitle: String { strings(.gardensCreateTitle) }
    public var createNameLabel: String { strings(.gardensCreateNameLabel) }
    public var createSubmitTitle: String { strings(.gardensCreateSubmit) }

    public func load() async {
        let hadCachedResult: Bool
        if let cached = try? await listGardens.cached(), !cached.isEmpty {
            state = .loaded(cached.map(summary))
            hadCachedResult = true
        } else {
            state = .loading
            hadCachedResult = false
        }

        do {
            // The network response itself is not rendered directly: a
            // garden with a pending offline mutation is deliberately left
            // out of it having synced yet (`LocalGardenStore
            // .replaceAll(with:)`), so the authoritative view for display is
            // always what local storage now holds, read back after the
            // refresh lands.
            _ = try await listGardens()
            let merged = try await listGardens.cached()
            state = .loaded(merged.map(summary))
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

    public func submitNewGarden() async {
        let name = newGardenName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        isCreating = true
        createErrorMessage = nil
        defer { isCreating = false }

        do {
            let garden = try await createGarden(name: name)
            locallySavedGardenIds.insert(garden.id)
            newGardenName = ""
            await load()
        } catch let error as GardenCommandError {
            createErrorMessage = message(for: error)
        } catch let error as APIGatewayError {
            createErrorMessage = message(for: error)
        } catch {
            createErrorMessage = strings(.serverUnexpected)
        }
    }

    private func summary(for garden: Garden) -> GardenSummary {
        GardenSummary(
            id: garden.id,
            name: garden.name,
            lifecycleLabel: lifecycleLabel(for: garden.lifecycleState),
            roleLabel: roleLabel(for: garden.callerRole),
            syncStatusLabel: locallySavedGardenIds.contains(garden.id) ? strings(.gardensSavedLocally) : nil
        )
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
