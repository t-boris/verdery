import Foundation
import Testing

@testable import CoreDomain

/// The link a plant label carries.
///
/// Worth pinning as values rather than trusting to the one call site: this
/// string is printed onto a physical marker and staked in the ground. A label
/// whose format changes stops working, and nobody finds out until they are
/// standing in front of a rose in the rain.
@Suite("Plant deep link")
struct PlantDeepLinkTests {
    @Test("survives a round trip")
    func roundTrips() throws {
        let link = PlantDeepLink(gardenId: "garden-1", plantId: "plant-1")
        let url = try #require(link.url)
        #expect(PlantDeepLink.parse(url) == link)
    }

    /// The shape the other two deep links in this application already use, so
    /// one parser handles all three.
    @Test("uses the scheme and shape the other links use")
    func usesEstablishedShape() throws {
        let url = try #require(PlantDeepLink(gardenId: "g", plantId: "p").url)
        #expect(url.scheme == "verdery")
        #expect(url.host == "plant")
        #expect(url.absoluteString.contains("gardenId=g"))
        #expect(url.absoluteString.contains("plantId=p"))
    }

    @Test("refuses a link that is not one of these")
    func refusesOtherLinks() throws {
        for text in [
            "verdery://invite?token=abc",
            "https://example.com/plant?gardenId=g&plantId=p",
            "verdery://plant",
        ] {
            let url = try #require(URL(string: text))
            #expect(PlantDeepLink.parse(url) == nil, "accepted \(text)")
        }
    }

    /// A link that opens "the plant with no id" lands on a screen that can
    /// only fail, which is worse than not opening at all.
    @Test("refuses blank identifiers rather than opening a screen that cannot work")
    func refusesBlanks() throws {
        for text in [
            "verdery://plant?gardenId=&plantId=p",
            "verdery://plant?gardenId=g&plantId=",
            "verdery://plant?gardenId=g",
        ] {
            let url = try #require(URL(string: text))
            #expect(PlantDeepLink.parse(url) == nil, "accepted \(text)")
        }
    }

    /// Identifiers are UUIDv7 and a label may be photographed at an angle in
    /// poor light, so the parse must not be case-sensitive about the parts it
    /// controls.
    @Test("tolerates the scheme and host in any case")
    func toleratesCase() throws {
        let url = try #require(URL(string: "VERDERY://PLANT?gardenId=g&plantId=p"))
        #expect(PlantDeepLink.parse(url)?.plantId == "p")
    }
}
