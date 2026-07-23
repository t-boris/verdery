import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — a
/// read-only device volume, for example. The garden list still works for
/// the running session; only its local persistence is lost. Never chosen by
/// default; `AppCompositionRoot` reaches for this after
/// `CorePersistence.LocalDatabase.open` throws.
public actor InMemoryGardenStore: LocalGardenStore {
    private var gardens: [String: Garden] = [:]

    /// Garden IDs with an offline mutation applied via
    /// `commitOfflineMutation` — mirrors what a real `sync_outbox` row marks
    /// pending in `GRDBGardenStore`, so `replaceAll`/`save` protect them the
    /// same way. Not durable, same as `gardens` above: this whole store
    /// isn't (see the type doc comment), so a process restart loses this
    /// bookkeeping exactly as it loses everything else this fallback holds.
    private var pendingGardenIds: Set<String> = []

    public init() {}

    public func fetchAll() async throws -> [Garden] {
        gardens.values.sorted { $0.createdAt > $1.createdAt }
    }

    public func replaceAll(with gardens: [Garden]) async throws {
        var updated = self.gardens.filter { pendingGardenIds.contains($0.key) }
        for garden in gardens where !pendingGardenIds.contains(garden.id) {
            updated[garden.id] = garden
        }
        self.gardens = updated
    }

    public func save(_ garden: Garden) async throws {
        guard !pendingGardenIds.contains(garden.id) else { return }
        gardens[garden.id] = garden
    }

    @discardableResult
    public func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: Garden?) throws -> (projection: Garden, operation: OutboxOperation)
    ) async throws -> Garden {
        let (projection, _) = try command(gardens[gardenId])
        gardens[projection.id] = projection
        pendingGardenIds.insert(projection.id)
        return projection
    }

    public func confirmSynced(gardenId: String, revision: Int) async throws {
        guard let current = gardens[gardenId] else { return }
        gardens[gardenId] = Garden(
            id: current.id,
            name: current.name,
            lifecycleState: current.lifecycleState,
            callerRole: current.callerRole,
            revision: revision,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        )
        // Mirrors what a real `sync_outbox` row's removal accomplishes for
        // `GRDBGardenStore`: `save`/`replaceAll` no longer protect this
        // garden from a server-confirmed overwrite once it is confirmed.
        pendingGardenIds.remove(gardenId)
    }

    public func remove(gardenId: String) async throws {
        gardens[gardenId] = nil
        pendingGardenIds.remove(gardenId)
    }
}
