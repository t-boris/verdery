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

    public func save(_ object: GardenMapObject) async throws {
        guard !pendingObjectIds.contains(object.id) else { return }
        var updated = objectsByGardenId[object.gardenId] ?? [:]
        updated[object.id] = object
        objectsByGardenId[object.gardenId] = updated
    }

    public func delete(objectId: String) async throws {
        guard !pendingObjectIds.contains(objectId) else { return }
        for (gardenId, objects) in objectsByGardenId where objects[objectId] != nil {
            objectsByGardenId[gardenId]?.removeValue(forKey: objectId)
            return
        }
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

    public func confirmSynced(objectId: String, revision: Int) async throws {
        for (gardenId, objects) in objectsByGardenId {
            guard let current = objects[objectId] else { continue }
            var updated = objects
            // Same content, new revision, same `updatedAt` — nothing about
            // the object's displayed state changed, only its confirmed sync
            // status. `replacingSnapshot` already expresses exactly that.
            updated[objectId] = current.replacingSnapshot(current.snapshot, revision: revision, updatedAt: current.updatedAt)
            objectsByGardenId[gardenId] = updated
            // Mirrors what a real `sync_outbox` row's removal accomplishes
            // for `GRDBMapStore`: `replaceAll` no longer protects this
            // object from a server-confirmed overwrite once it is confirmed.
            pendingObjectIds.remove(objectId)
            return
        }
    }

    public func removeAll(gardenId: String) async throws {
        for objectId in (objectsByGardenId[gardenId] ?? [:]).keys {
            pendingObjectIds.remove(objectId)
        }
        objectsByGardenId[gardenId] = nil
    }
}
