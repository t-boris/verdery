import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — a
/// read-only device volume, for example. The garden list still works for
/// the running session; only its local persistence is lost. Never chosen by
/// default; `AppCompositionRoot` reaches for this after
/// `CorePersistence.LocalDatabase.open` throws.
public actor InMemoryGardenStore: LocalGardenStore {
    private var gardens: [String: Garden] = [:]

    public init() {}

    public func fetchAll() async throws -> [Garden] {
        gardens.values.sorted { $0.createdAt > $1.createdAt }
    }

    public func replaceAll(with gardens: [Garden]) async throws {
        self.gardens = Dictionary(uniqueKeysWithValues: gardens.map { ($0.id, $0) })
    }

    public func save(_ garden: Garden) async throws {
        gardens[garden.id] = garden
    }
}
