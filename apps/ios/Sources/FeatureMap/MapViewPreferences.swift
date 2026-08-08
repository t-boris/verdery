import Foundation

/// Which layers a person has hidden or locked in one garden's map.
///
/// A client preference, not garden state. The architecture document is explicit
/// about it — "Layer visibility and opacity are user preferences. Domain
/// objects do not store arbitrary visual stacking" — and the web keeps the same
/// two sets in `localStorage` under `verdery.map.view.v2.<gardenId>`. Neither
/// client sends them anywhere, so hiding a layer on a laptop does not hide it
/// on a phone, by design and by the owner's decision.
///
/// What was NOT deliberate is that iOS forgot them the moment the map reloaded.
/// A preference that resets whenever the document is re-read is not a
/// preference; it is a control that appears to do nothing the next time you
/// look. This gives them the same standing on the device that the web already
/// gives them in the browser.
public struct MapViewPreferences: Equatable, Sendable {
    public var hiddenLayers: Set<MapLayer>
    public var lockedLayers: Set<MapLayer>

    public static let none = MapViewPreferences(hiddenLayers: [], lockedLayers: [])

    public init(hiddenLayers: Set<MapLayer>, lockedLayers: Set<MapLayer>) {
        self.hiddenLayers = hiddenLayers
        self.lockedLayers = lockedLayers
    }
}

/// Where one garden's map preferences are kept between visits.
///
/// A protocol so the editor's tests get a store that starts empty and stays in
/// the test, rather than sharing the test process's `UserDefaults` with every
/// other test that ran before them.
@MainActor
public protocol MapViewPreferenceStore: AnyObject {
    func preferences(gardenId: String) -> MapViewPreferences
    func save(_ preferences: MapViewPreferences, gardenId: String)
}

/// The default: remembers nothing past the object's own lifetime.
///
/// Deliberately what `MapEditorViewModel` falls back to, so a test that says
/// nothing about preferences gets isolation instead of whatever the last test
/// wrote. The composition root passes the persistent one.
@MainActor
public final class InMemoryMapViewPreferenceStore: MapViewPreferenceStore {
    private var byGarden: [String: MapViewPreferences] = [:]

    public init() {}

    public func preferences(gardenId: String) -> MapViewPreferences {
        byGarden[gardenId] ?? .none
    }

    public func save(_ preferences: MapViewPreferences, gardenId: String) {
        byGarden[gardenId] = preferences
    }
}

/// The shipped one, in `UserDefaults`.
///
/// `UserDefaults` rather than the profile database: this is a per-device
/// display preference with no revision, no conflict and nothing to synchronize,
/// and putting it in the garden's local tables would make it look like
/// something that syncs. The same reasoning the web applies by reaching for
/// `localStorage` instead of the API.
///
/// Unknown layer names are dropped on read rather than refused. A layer this
/// build does not know about is one an older or newer build hid; forgetting it
/// shows one layer too many, which is recoverable, while failing the whole read
/// would silently discard the other three.
@MainActor
public final class UserDefaultsMapViewPreferenceStore: MapViewPreferenceStore {
    private let defaults: UserDefaults
    private let keyPrefix: String

    public init(defaults: UserDefaults = .standard, keyPrefix: String = "verdery.map.view.v1") {
        self.defaults = defaults
        self.keyPrefix = keyPrefix
    }

    public func preferences(gardenId: String) -> MapViewPreferences {
        MapViewPreferences(
            hiddenLayers: layers(forKey: key(gardenId, "hiddenLayers")),
            lockedLayers: layers(forKey: key(gardenId, "lockedLayers"))
        )
    }

    public func save(_ preferences: MapViewPreferences, gardenId: String) {
        write(preferences.hiddenLayers, forKey: key(gardenId, "hiddenLayers"))
        write(preferences.lockedLayers, forKey: key(gardenId, "lockedLayers"))
    }

    private func key(_ gardenId: String, _ name: String) -> String {
        "\(keyPrefix).\(gardenId).\(name)"
    }

    private func layers(forKey key: String) -> Set<MapLayer> {
        let stored = defaults.stringArray(forKey: key) ?? []
        return Set(stored.compactMap(MapLayer.init(rawValue:)))
    }

    private func write(_ layers: Set<MapLayer>, forKey key: String) {
        // Sorted, so the stored value depends on what is hidden and not on the
        // order a `Set` happened to iterate in — which makes the defaults file
        // readable and a comparison of two writes meaningful.
        if layers.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(layers.map(\.rawValue).sorted(), forKey: key)
        }
    }
}
