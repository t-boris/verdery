import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for task assignment and its supporting reads (P9A-TASK-01).
///
/// Every one of these is ONLINE, gateway-backed, with no local PROJECTION and
/// no outbox operation — the same deliberate posture
/// `FeatureRecommendations.TodayUseCases`'s own doc comment documents for its
/// own feedback commands, applied here for a different reason: assignment
/// eligibility depends on the ASSIGNEE's own capability
/// (`assign-task.ts`'s header comment — "the assignee must independently
/// hold `editGardenContent` too"), which only the server can evaluate at the
/// moment of the command. An optimistic local projection would have to
/// either guess that outcome or skip the check entirely, either of which
/// could show a task as assigned to someone the server then rejects — so
/// this reuses `TaskGateway` directly rather than routing through
/// `LocalTaskStore.commitOfflineMutation` the way the seven Stage 4e
/// commands do.
///
/// `AssignTask` still WRITES THROUGH to `LocalTaskStore` once the server
/// confirms the assignment — see its own doc comment for why this is not
/// optional: `TasksListViewModel.load()` always rebuilds its state from
/// `LocalTaskStore`, never from an in-memory patch alone, so a confirmed
/// assignment that never reached the local store would silently vanish the
/// next time anything calls `load()` (a pull-to-refresh, or simply another
/// row's own action, which always reloads after it commits).
///
/// Source: implementation-plan.md work package P9A-TASK-01, P9A-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Tasks`.
public struct AssignTask: Sendable {
    private let gateway: any TaskGateway
    private let localStore: any LocalTaskStore

    public init(gateway: any TaskGateway, localStore: any LocalTaskStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    /// `assigneeProfileId: nil` unassigns — one operation for assign,
    /// reassign, and unassign, matching `assignTask`'s own domain doc
    /// comment ("no first-assignment precondition").
    ///
    /// Writes the server's confirmed response through to `LocalTaskStore`
    /// via `save(_:)` — the same "upsert one server-confirmed task" contract
    /// `TaskSyncRecordApplier.applyUpsert`/`ListTasksForGarden`'s own
    /// unfiltered-fetch write-through already rely on, and `save(_:)`'s own
    /// "except when still pending" guard is exactly correct here too: this
    /// task cannot have a pending offline mutation queued for it, since
    /// `AssignTask` itself never enqueues one and every offline command
    /// requires `planned`/`suggested` status the same way this one does.
    public func callAsFunction(
        gardenId: String,
        taskId: String,
        assigneeProfileId: String?,
        expectedRevision: Int
    ) async throws -> GardenTask {
        let updated = try await gateway.assignTask(
            gardenId: gardenId,
            taskId: taskId,
            assigneeProfileId: assigneeProfileId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
        try await localStore.save(updated)
        return updated
    }
}

/// Reads a task's shared activity history — every garden role may call this
/// (`viewGarden`), matching `GetTaskActivity`'s own server-side capability
/// choice.
public struct GetTaskActivity: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, taskId: String) async throws -> [TaskActivityEntry] {
        try await gateway.listTaskActivity(gardenId: gardenId, taskId: taskId)
    }
}

/// The garden's active member roster, read for the assignment picker and for
/// labelling an existing assignment/completion.
///
/// Wraps `CollaborationGateway.listMembers(gardenId:)` — the P9A-API-01
/// collaboration-administration read `GET /gardens/{gardenId}/members` maps
/// to — rather than `FeatureTasks` declaring its own parallel member read:
/// `CollaborationGateway` and `CoreDomain.GardenMember` are Core, not
/// `FeatureGardens`-owned, so any feature may depend on them directly, and
/// this is the same endpoint either way. A thin wrapper, deliberately doing
/// no role filtering itself — `TasksListViewModel` filters to `owner`/
/// `editor` for the assignment picker, the same "gateway returns the full
/// read, the view model shapes it for one screen's own display need" split
/// `ListTasksForGarden`/`TasksListViewModel.applyLoaded`'s `statusFilter`
/// already establishes.
public struct ListGardenMembers: Sendable {
    private let gateway: any CollaborationGateway

    public init(gateway: any CollaborationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenMember] {
        try await gateway.listMembers(gardenId: gardenId)
    }
}
