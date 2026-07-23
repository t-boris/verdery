import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — mirrors
/// `FeatureGardens.InMemoryGardenStore`'s identical reasoning and scope.
public actor InMemoryPlantStore: LocalPlantStore {
    private var plants: [String: Plant] = [:]

    /// Plant ids with an offline mutation applied via `commitOfflineMutation`
    /// — mirrors what a real `sync_outbox` row marks pending in
    /// `GRDBPlantStore`, so `save` protects them the same way. Not durable,
    /// same as `plants` above: this whole store isn't (see the type doc
    /// comment), so a process restart loses this bookkeeping exactly as it
    /// loses everything else this fallback holds.
    private var pendingPlantIds: Set<String> = []

    public init() {}

    public func fetch(plantId: String) async throws -> Plant? {
        plants[plantId]
    }

    public func save(_ plant: Plant) async throws {
        guard !pendingPlantIds.contains(plant.id) else { return }
        plants[plant.id] = plant
    }

    @discardableResult
    public func commitOfflineMutation(
        plantId: String,
        command: @Sendable (_ current: Plant?) throws -> (projection: Plant, operation: OutboxOperation)
    ) async throws -> Plant {
        let (projection, _) = try command(plants[plantId])
        plants[projection.id] = projection
        pendingPlantIds.insert(projection.id)
        return projection
    }
}
