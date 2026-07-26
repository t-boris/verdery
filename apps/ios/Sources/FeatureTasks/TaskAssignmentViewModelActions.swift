import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation

/// Assignment, activity history, and the shared member roster behind both
/// (P9A-TASK-01) — split from `TasksListViewModelActions.swift` the same way
/// that file is split from `TasksListViewModel.swift` itself: one topic per
/// extension file, all three still one type.
///
/// Unlike every row action in `TasksListViewModelActions.swift`, these three
/// are ONLINE calls with no local projection and no outbox operation — see
/// `TaskAssignmentUseCases.swift`'s own doc comment for why.
extension TasksListViewModel {
    /// Loads (or reloads) this garden's active member roster into
    /// `membersById` — the shared lookup every row's assignment/completion
    /// label, the assign sheet's candidate list, and the activity sheet's
    /// actor/assignee names all resolve against. Best-effort when called from
    /// `load()`'s own eager refresh (a failure here must never fail the whole
    /// task list); the assign sheet instead calls this directly and surfaces
    /// its own failure, since a picker with no candidates and no explanation
    /// would look broken rather than merely offline.
    func refreshMembersById() async {
        guard let members = try? await listGardenMembers(gardenId: gardenId) else { return }
        membersById = Dictionary(uniqueKeysWithValues: members.map { ($0.profileId, $0.role) })
    }

    /// Triggered by the assign sheet's own `.task {}` when it is presented —
    /// the same "view triggers the load its own sheet needs" shape
    /// `TasksListView.body`'s `.task { await model.load() }` already
    /// establishes for the screen itself. Always re-fetches rather than
    /// trusting a `membersById` populated by an earlier `load()`: the roster
    /// can change (a new editor invited, a member removed) between this
    /// screen's last load and the moment someone opens the assign sheet, and
    /// stale candidates here would let the picker offer someone no longer
    /// eligible.
    public func loadAssignCandidates() async {
        isLoadingAssignCandidates = true
        assignCandidatesErrorMessage = nil
        defer { isLoadingAssignCandidates = false }

        do {
            let members = try await listGardenMembers(gardenId: gardenId)
            membersById = Dictionary(uniqueKeysWithValues: members.map { ($0.profileId, $0.role) })
        } catch {
            assignCandidatesErrorMessage = strings(.tasksAssignCandidatesFailed)
        }
    }

    /// Assigns, reassigns, or unassigns (`assigneeProfileId: nil`) the task
    /// `assigningTaskId` names. `expectedRevision` is this screen's own
    /// last-seen `task.revision` — a stale value (someone else changed the
    /// task since this screen loaded it) is exactly what
    /// `isRevisionConflict(_:)` below detects and surfaces as its own clean
    /// message, then refreshes so a retry starts from the current state, the
    /// identical shape `FeatureRecommendations.TodayViewModelActions
    /// .performItemAction` already established for its own revision-guarded
    /// commands.
    public func submitAssign(taskId: String, assigneeProfileId: String?) async {
        guard let task = tasksById[taskId] else { return }

        isSubmittingAssign = true
        assignErrorMessage = nil
        defer { isSubmittingAssign = false }

        do {
            let updated = try await assignTask(
                gardenId: gardenId,
                taskId: taskId,
                assigneeProfileId: assigneeProfileId,
                expectedRevision: task.revision
            )
            tasksById[taskId] = updated
            applyLoadedFromCurrentTasks()
            assigningTaskId = nil
        } catch let error as APIGatewayError {
            assignErrorMessage = assignMessage(for: error)
            if isRevisionConflict(error) {
                // The task moved past what this screen showed — refresh so
                // the sheet's own next attempt (or the row behind it) starts
                // from the current revision, not the stale one that just
                // lost.
                await load()
            }
        } catch {
            assignErrorMessage = strings(.serverUnexpected)
        }
    }

    /// Loads `viewingActivityTaskId`'s shared activity history, triggered by
    /// the activity sheet's own `.task {}` — the same lifecycle-driven load
    /// `loadAssignCandidates()` above uses for its own sheet.
    public func loadActivity(taskId: String) async {
        activityState = .loading

        do {
            let entries = try await getTaskActivity(gardenId: gardenId, taskId: taskId)
            let rows = entries.map { TaskCollaborationLocalization.row(for: $0, roster: membersById, strings: strings) }
            activityState = .loaded(rows)
        } catch let error as APIGatewayError {
            activityState = .failed(message: message(for: error))
        } catch {
            activityState = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Re-renders `state` from `tasksById` as it stands right now — used
    /// after `submitAssign`'s own direct `tasksById` write, mirroring
    /// `applyLoaded`'s own row-building but without re-deriving `tasksById`
    /// itself from a fresh fetch (the single updated task from `AssignTask`'s
    /// own response is already the authoritative new state for that one
    /// row).
    private func applyLoadedFromCurrentTasks() {
        let tasks = Array(tasksById.values)
        let filtered = statusFilter.map { status in tasks.filter { $0.status == status } } ?? tasks
        state = .loaded(filtered.map(row))
    }

    /// `409 Conflict` (already idempotently acted on with a different key, or
    /// the task's status is no longer legal for assignment) and `412
    /// Precondition Failed` (the revision guard) both mean "the server's
    /// task moved past what this screen shows" — one refresh-and-retry
    /// surface, the identical pairing `TodayViewModelActions
    /// .isRevisionConflict`'s own doc comment documents for its own
    /// revision-guarded commands.
    private func isRevisionConflict(_ error: APIGatewayError) -> Bool {
        if case let .service(_, statusCode, _) = error {
            return statusCode == 409 || statusCode == 412
        }
        return false
    }

    private func assignMessage(for error: APIGatewayError) -> String {
        if isRevisionConflict(error) {
            return strings(.tasksAssignConflict)
        }
        return message(for: error)
    }
}
