import CoreDomain
import Testing
@testable import CoreNetworking

@Suite("Plant search filters — query encoding")
struct PlantSearchFiltersTests {
    // An empty collection means "no restriction". Sending `healthConcern=`
    // would say something else entirely, and the server would reject it.
    @Test("contributes nothing when every filter is off")
    func noneEncodesNothing() {
        #expect(PlantSearchFilters.none.queryItems.isEmpty)
    }

    @Test("encodes multi-value filters as comma-separated lists")
    func multiValueEncoding() {
        let filters = PlantSearchFilters(
            healthConcern: [.pest, .disease],
            distributionStatus: [.invasive, .regulated]
        )

        #expect(filters.queryItems.contains("healthConcern=pest,disease"))
        #expect(filters.queryItems.contains("distributionStatus=invasive,regulated"))
    }

    @Test("uses the wire spelling of activities, not the Swift case name")
    func activityWireSpelling() {
        let filters = PlantSearchFilters(seasonalActivity: [.sowIndoors, .sowOutdoors])

        #expect(filters.queryItems.contains("seasonalActivity=sow_indoors,sow_outdoors"))
    }

    // A region of spaces narrows nothing and must not reach the server as if
    // it did — the same rule the web client and the API parser both apply.
    @Test("drops a blank region")
    func blankRegionDropped() {
        let filters = PlantSearchFilters(distributionRegion: "   ")

        #expect(!filters.queryItems.contains { $0.hasPrefix("distributionRegion=") })
    }

    @Test("percent-encodes a region that needs it")
    func regionEncoded() {
        let filters = PlantSearchFilters(distributionRegion: "US CA")

        #expect(filters.queryItems.contains("distributionRegion=US%20CA"))
    }

    @Test("carries both recency bounds independently")
    func recencyBounds() {
        #expect(
            PlantSearchFilters(observedWithinDays: 7).queryItems == ["observedWithinDays=7"]
        )
        #expect(
            PlantSearchFilters(notObservedForDays: 90).queryItems == ["notObservedForDays=90"]
        )
    }
}
