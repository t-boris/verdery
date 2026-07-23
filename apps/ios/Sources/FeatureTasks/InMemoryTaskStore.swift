import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — mirrors
/// `FeaturePlants.InMemoryPlantStore`'s identical reasoning and scope.
public actor InMemoryTaskStore: LocalTaskStore {
    private var tasks: [String: GardenTask] = [:]

    /// Task ids with an offline mutation applied via `commitOfflineMutation`
    /// — mirrors what a real `sync_outbox` row marks pending in
    /// `GRDBTaskStore`, so `replaceAll` protects them the same way. Not
    /// durable, same as `tasks` above: this whole store isn't (see the type
    /// doc comment), so a process restart loses this bookkeeping exactly as
    /// it loses everything else this fallback holds.
    private var pendingTaskIds: Set<String> = []

    public init() {}

    public func fetchAll(gardenId: String) async throws -> [GardenTask] {
        tasks.values
            .filter { $0.gardenId == gardenId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public func replaceAll(gardenId: String, with newTasks: [GardenTask]) async throws {
        let existingIds = tasks.values.filter { $0.gardenId == gardenId }.map(\.id)
        for id in existingIds where !pendingTaskIds.contains(id) {
            tasks.removeValue(forKey: id)
        }

        for task in newTasks where !pendingTaskIds.contains(task.id) {
            tasks[task.id] = task
        }
    }

    @discardableResult
    public func commitOfflineMutation(
        taskId: String,
        command: @Sendable (_ current: GardenTask?) throws -> (projection: GardenTask, operation: OutboxOperation)
    ) async throws -> GardenTask {
        let (projection, _) = try command(tasks[taskId])
        tasks[projection.id] = projection
        pendingTaskIds.insert(projection.id)
        return projection
    }
}
