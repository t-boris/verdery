import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — mirrors
/// `FeatureGardens.InMemoryGardenStore`'s identical reasoning and scope.
public actor InMemoryMapStore: LocalMapStore {
    private var objectsByGardenId: [String: [String: GardenMapObject]] = [:]

    /// Object ids with an offline mutation applied via
    /// `commitOfflineMutation` — mirrors what a real `sync_outbox` row marks
    /// pending in `GRDBMapStore`, so `replaceAll` protects them the same way.
    /// Not durable, same as `objectsByGardenId` above.
    private var pendingObjectIds: Set<String> = []

    public init() {}

    public func fetchAll(gardenId: String) async throws -> [GardenMapObject] {
        Array((objectsByGardenId[gardenId] ?? [:]).values)
    }

    public func replaceAll(gardenId: String, with objects: [GardenMapObject]) async throws {
        var updated = (objectsByGardenId[gardenId] ?? [:]).filter { pendingObjectIds.contains($0.key) }
        for object in objects where !pendingObjectIds.contains(object.id) {
            updated[object.id] = object
        }
        objectsByGardenId[gardenId] = updated
    }

    @discardableResult
    public func commitOfflineMutation(
        gardenId: String,
        command: @Sendable (_ current: [String: GardenMapObject]) throws -> (projections: [GardenMapObject], operation: OutboxOperation)
    ) async throws -> [GardenMapObject] {
        let current = objectsByGardenId[gardenId] ?? [:]
        let (projections, _) = try command(current)

        var updated = current
        for projection in projections {
            updated[projection.id] = projection
            pendingObjectIds.insert(projection.id)
        }
        objectsByGardenId[gardenId] = updated
        return projections
    }
}
