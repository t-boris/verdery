import Foundation

/// A link that opens one plant.
///
/// The identifier is minted on this device before anything is sent, so a plant
/// has its final address from the moment it exists — the API path, and this.
/// That is what makes the label below possible: the link can be printed
/// before the record has ever reached a server.
///
/// # The plant label
///
/// Rendered as a QR code and staked beside the plant, this turns the third
/// observation of a specific rose into: point the system camera at the label,
/// tap the banner, shoot. No launching into a list, no searching, no
/// scrolling — and no in-app scanner to build, because iOS already offers to
/// open a URL it sees through the ordinary Camera app.
///
/// Safe by the rule `notifications.md` section 11 already fixes for every
/// other link in this product: a deep link "contains stable application routes
/// and resource IDs, not bearer access", and the client "authenticates and
/// authorizes after opening". A label read by somebody walking past a fence
/// therefore discloses two opaque UUIDs and grants nothing.
public struct PlantDeepLink: Sendable, Equatable {
    public static let scheme = "verdery"
    public static let host = "plant"

    public let gardenId: String
    public let plantId: String

    public init(gardenId: String, plantId: String) {
        self.gardenId = gardenId
        self.plantId = plantId
    }

    /// `verdery://plant?gardenId=…&plantId=…`
    ///
    /// Query parameters rather than path components, matching the shape the
    /// invitation and ownership-transfer links already use, so one parser
    /// handles all three.
    public var url: URL? {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = Self.host
        components.queryItems = [
            URLQueryItem(name: "gardenId", value: gardenId),
            URLQueryItem(name: "plantId", value: plantId),
        ]
        return components.url
    }

    /// Reads one back, or `nil` for anything that is not one.
    ///
    /// Empty identifiers are rejected rather than accepted as blanks: a link
    /// that opens "the plant with no id" would land on a screen that can only
    /// fail, which is worse than not opening at all.
    public static func parse(_ url: URL) -> PlantDeepLink? {
        guard
            url.scheme?.lowercased() == scheme,
            url.host?.lowercased() == host,
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else {
            return nil
        }

        func value(_ name: String) -> String? {
            let found = items.first { $0.name == name }?.value
            return (found?.isEmpty ?? true) ? nil : found
        }

        guard let gardenId = value("gardenId"), let plantId = value("plantId") else { return nil }
        return PlantDeepLink(gardenId: gardenId, plantId: plantId)
    }
}
