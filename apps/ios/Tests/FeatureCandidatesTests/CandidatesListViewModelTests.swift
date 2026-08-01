import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureCandidates

@MainActor
@Suite("Candidates list view model")
struct CandidatesListViewModelTests {
    private func candidate(_ id: String, name: String, status: PlantCandidateStatus = .active) -> PlantCandidate {
        PlantCandidate(
            id: id, gardenId: "garden-1", proposedGardenAreaMapObjectId: nil,
            proposedPlacementMapObjectId: nil, displayName: name, taxonomyReferenceId: nil,
            varietyLabel: nil, groupingKind: .individual, quantity: nil, status: status,
            rationaleNote: nil, priority: nil, priceAmount: nil, priceCurrency: nil,
            purchaseSource: nil, alternativeToCandidateId: nil, revision: 1,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(gateway: FakePlantCandidateGateway) -> CandidatesListViewModel {
        CandidatesListViewModel(
            gardenId: "garden-1",
            listCandidates: ListCandidates(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load() shows the first page and whether a further page exists")
    func loadShowsFirstPage() async {
        let gateway = FakePlantCandidateGateway()
        gateway.listCandidatesPages[nil] = PlantCandidateListPage(
            items: [candidate("candidate-1", name: "Fig tree")], nextCursor: "cursor-2"
        )
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(items, nextCursor) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["candidate-1"])
        #expect(nextCursor == "cursor-2")
    }

    @Test("load() surfaces a gateway failure as .failed")
    func loadSurfacesFailure() async {
        let gateway = FakePlantCandidateGateway()
        gateway.listCandidatesError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }

    @Test("toggling a status filter re-searches with that status included")
    func toggleStatusReSearches() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)
        await model.load()

        model.toggleStatus(.rejected)
        await model.filtersDidChange()

        #expect(gateway.listCandidatesQueries.last?.status == [.rejected])
    }

    @Test("toggling a priority filter re-searches with that priority included")
    func togglePriorityReSearches() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)
        await model.load()

        model.togglePriority(.high)
        await model.filtersDidChange()

        #expect(gateway.listCandidatesQueries.last?.priority == [.high])
    }

    @Test("an empty filter selection omits the parameter, matching every value")
    func emptyFilterOmitsParameter() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)

        await model.load()

        #expect(gateway.listCandidatesQueries.last?.status == nil)
        #expect(gateway.listCandidatesQueries.last?.priority == nil)
    }

    @Test("loadMore() appends the next page and advances nextCursor")
    func loadMoreAppendsNextPage() async {
        let gateway = FakePlantCandidateGateway()
        gateway.listCandidatesPages[nil] = PlantCandidateListPage(
            items: [candidate("candidate-1", name: "Fig tree")], nextCursor: "cursor-2"
        )
        gateway.listCandidatesPages["cursor-2"] = PlantCandidateListPage(
            items: [candidate("candidate-2", name: "Apple tree")], nextCursor: nil
        )
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.loadMore()

        guard case let .loaded(items, nextCursor) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["candidate-1", "candidate-2"])
        #expect(nextCursor == nil)
    }
}
