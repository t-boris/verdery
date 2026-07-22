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
            let fresh = try await listGardens()
            state = .loaded(fresh.map(summary))
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
            _ = try await createGarden(name: name)
            newGardenName = ""
            await load()
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
            roleLabel: roleLabel(for: garden.callerRole)
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
}
