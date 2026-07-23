/// Local validation and precondition failures for the seven offline-capable
/// task commands (`CreateManualTask`, `EditTask`, `RescheduleTask`,
/// `CompleteTask`, `DismissTask`, `SkipTask`, `DeleteTask`).
///
/// Source: architecture/offline-synchronization.md, section "6. Local
/// Mutation Transaction", step 2 ("Validate the command locally").
public enum TaskCommandError: Error, Equatable, Sendable {
    /// The title is empty after trimming, or longer than the contract's
    /// 200-character limit (`packages/api-contracts/openapi.yaml`,
    /// `CreateManualTaskRequest.title` / `EditTaskRequest.title`,
    /// `maxLength: 200`) — mirrors the backend's own `validateTaskTitle`
    /// (`tasks-recommendations/domain/task.ts`). Not previously enforced
    /// client-side beyond non-empty (`CreateTaskFormValidation` only checked
    /// that) even though its own catalogue string, `tasks.titleRequired`,
    /// already read "Enter a title up to 200 characters" — a
    /// declared-but-unwired limit, the same gap `FeatureGardens
    /// .gardenNameMaxLength`'s own doc comment describes for
    /// `gardens.name.required`.
    case invalidTitle

    /// `EditTask`/`RescheduleTask`/`CompleteTask`/`DismissTask`/`SkipTask`/
    /// `DeleteTask` target a task this device has no local read-model row for
    /// yet — step 1 of the local mutation transaction ("Load the current
    /// local record") found nothing to apply the command to.
    ///
    /// Not reachable through the shipped UI today: `TasksListViewModel.load()`
    /// always populates the local row set — from cache or from
    /// `ListTasksForGarden` — before any row action control is enabled, the
    /// same "not reachable, kept as a real tested failure mode rather than a
    /// force-unwrap" reasoning `FeaturePlants.PlantCommandError
    /// .localRecordNotFound`'s own doc comment gives.
    case localRecordNotFound

    /// The target task's status is not `planned`/`suggested`
    /// (`TaskStatus.isMutable`) — mirrors the backend's own
    /// `requireEditableStatus` (`tasks-recommendations/domain/task-lifecycle.ts`),
    /// the shared precondition every command beyond `CreateManualTask`
    /// enforces there. Previously enforced only by the server round trip this
    /// stage removes; `TasksListViewModelActions.performRowAction` already
    /// guards on `TaskRow.isMutable` before ever calling in, so this is not
    /// reachable through the shipped UI either — kept as a real tested
    /// failure mode for the same reason as `localRecordNotFound`, not a
    /// force-unwrap.
    case taskNotEditable

    /// The built payload could not be encoded to UTF-8 JSON text. Not
    /// expected to actually occur — `JSONEncoder`'s output is always valid
    /// UTF-8 — but `TaskSyncCommandPayload.encode` has no force-unwrap, so
    /// this exists as the alternative to one.
    case payloadEncodingFailed
}
