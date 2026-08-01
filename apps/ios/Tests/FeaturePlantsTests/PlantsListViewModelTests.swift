import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plants list view model")
struct PlantsListViewModelTests {
    private func makeModel(gateway: FakePlantGateway) -> PlantsListViewModel {
        PlantsListViewModel(
            gardenId: "garden-1",
            searchPlants: SearchPlants(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    private func plant(_ id: String, name: String) -> Plant {
        Plant(
            id: id,
            gardenId: "garden-1",
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            displayName: name,
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("load() shows the first page and whether a further page exists")
    func loadShowsFirstPage() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(
            items: [plant("plant-1", name: "Tomato")],
            nextCursor: "cursor-2"
        )
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(items, nextCursor) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["plant-1"])
        #expect(nextCursor == "cursor-2")
    }

    @Test("load() surfaces a gateway failure as .failed")
    func loadSurfacesFailure() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }

    @Test("load() sends the trimmed search text as the query, or nil when blank")
    func loadSendsTrimmedQuery() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(items: [], nextCursor: nil)
        let model = makeModel(gateway: gateway)

        model.searchText = "  tomato  "
        await model.load()
        #expect(gateway.searchPlantsQueries.last?.query == "tomato")

        model.searchText = "   "
        await model.load()
        #expect(gateway.searchPlantsQueries.last?.query == nil)
    }

    @Test("identifiedFilterDidChange() re-searches immediately with the selected filter's query value")
    func identifiedFilterDidChangeReSearches() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(items: [], nextCursor: nil)
        let model = makeModel(gateway: gateway)
        await model.load()
        #expect(gateway.searchPlantsQueries.last?.identified == nil)

        model.identifiedFilter = .identified
        await model.identifiedFilterDidChange()
        #expect(gateway.searchPlantsQueries.last?.identified == true)

        model.identifiedFilter = .unidentified
        await model.identifiedFilterDidChange()
        #expect(gateway.searchPlantsQueries.last?.identified == false)

        model.identifiedFilter = .all
        await model.identifiedFilterDidChange()
        #expect(gateway.searchPlantsQueries.last?.identified == nil)
    }

    @Test("load() and loadMore() both exclude removed plants by default, since there is no filter UI yet")
    func loadExcludesRemovedByDefault() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(items: [], nextCursor: "cursor-2")
        gateway.searchPlantsPages["cursor-2"] = PlantSearchPage(items: [], nextCursor: nil)
        let model = makeModel(gateway: gateway)

        await model.load()
        await model.loadMore()

        for query in gateway.searchPlantsQueries {
            #expect(query.status?.contains(.removed) == false)
        }
    }

    @Test("loadMore() appends the next page and advances nextCursor")
    func loadMoreAppendsNextPage() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(
            items: [plant("plant-1", name: "Tomato")],
            nextCursor: "cursor-2"
        )
        gateway.searchPlantsPages["cursor-2"] = PlantSearchPage(
            items: [plant("plant-2", name: "Basil")],
            nextCursor: nil
        )
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.loadMore()

        guard case let .loaded(items, nextCursor) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["plant-1", "plant-2"])
        #expect(nextCursor == nil)
    }

    @Test("loadMore() is a no-op once the last page has been reached")
    func loadMoreNoOpAtLastPage() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(
            items: [plant("plant-1", name: "Tomato")],
            nextCursor: nil
        )
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.loadMore()

        #expect(gateway.searchPlantsQueries.count == 1)
    }

    @Test("a failed loadMore() leaves the already-loaded page displayed")
    func loadMoreFailureKeepsExistingPage() async {
        let gateway = FakePlantGateway()
        gateway.searchPlantsPages[nil] = PlantSearchPage(
            items: [plant("plant-1", name: "Tomato")],
            nextCursor: "cursor-2"
        )
        let model = makeModel(gateway: gateway)
        await model.load()

        gateway.searchPlantsError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        await model.loadMore()

        guard case let .loaded(items, nextCursor) = model.state else {
            Issue.record("Expected loaded state to survive a failed loadMore()")
            return
        }
        #expect(items.map(\.id) == ["plant-1"])
        #expect(nextCursor == "cursor-2")
    }
}
