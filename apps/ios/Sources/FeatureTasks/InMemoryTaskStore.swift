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

    public func save(_ task: GardenTask) async throws {
        guard !pendingTaskIds.contains(task.id) else { return }
        tasks[task.id] = task
    }

    public func delete(taskId: String) async throws {
        guard !pendingTaskIds.contains(taskId) else { return }
        tasks.removeValue(forKey: taskId)
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

    public func confirmSynced(taskId: String, revision: Int) async throws {
        guard let current = tasks[taskId] else { return }
        tasks[taskId] = GardenTask(
            id: current.id,
            gardenId: current.gardenId,
            targetKind: current.targetKind,
            targetGardenAreaMapObjectId: current.targetGardenAreaMapObjectId,
            targetPlantId: current.targetPlantId,
            title: current.title,
            notes: current.notes,
            status: current.status,
            dueDate: current.dueDate,
            timeWindowStart: current.timeWindowStart,
            timeWindowEnd: current.timeWindowEnd,
            recurrenceRule: current.recurrenceRule,
            urgency: current.urgency,
            source: current.source,
            originObservationId: current.originObservationId,
            revision: revision,
            createdByProfileId: current.createdByProfileId,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            completedAt: current.completedAt
        )
        // Mirrors what a real `sync_outbox` row's removal accomplishes for
        // `GRDBTaskStore`: `replaceAll` no longer protects this task from a
        // server-confirmed overwrite once it is confirmed.
        pendingTaskIds.remove(taskId)
    }
}
