/**
 * Task assignment event contract (P9A-TASK-01).
 *
 * Hand-written, machine-to-machine, exactly like `recommendation-events.ts`:
 * this is the `platform.outbox_event` contract between `services/api`'s
 * `AssignTask` (the producer — it appends one event per accepted assign or
 * reassign, in the same transaction as the assignment write) and a future
 * notification consumer (notifications.md section 5's flow starts at "domain
 * event", and "you were assigned a task" is a collaboration notification in
 * that same shape). Never a client-facing HTTP body, so it has no place in
 * openapi.yaml.
 *
 * EMITTED UNCLAIMED, deliberately, the same honest ordering
 * `recommendation-events.ts`'s own header documents: P9A-TASK-01 owns the
 * task-side commands (assign/reassign/completion attribution/activity
 * history) and appending must happen inside the assignment-writing
 * transaction — retrofitting it once a consumer exists would reopen that
 * transaction path. `services/workers`' relay claims only its own recognized
 * event types (`outbox-relay.ts`), and wiring a `task.assigned` consumer into
 * `notifications/application/apply-notification-policy.ts` plus the relay's
 * recognized-type list is explicitly out of this work package's scope (its
 * boundary is `tasks-recommendations`, plus a read-only look at
 * `notifications`) — a later work package does both, the same relationship
 * P7-NOTIF-01 had to `recommendation.candidate_created`. Until then, rows of
 * this type simply stay unpublished, harmlessly: nothing mis-routes them, and
 * this table has carried unclaimed rows before with no ill effect.
 *
 * An UNASSIGNMENT (`assigneeProfileId: null`) appends no event — there is no
 * one left to notify.
 */

/**
 * The `platform.outbox_event.event_type` appended once per accepted task
 * assignment or reassignment (never for an unassignment), in the same
 * transaction as the task's own `assigned_profile_id`/`assigned_at` write and
 * its `task_revision` journal row.
 */
export const TASK_ASSIGNED_EVENT_TYPE = 'task.assigned';

/**
 * The `platform.outbox_event.payload` shape for `TASK_ASSIGNED_EVENT_TYPE`.
 * Identifiers only (architecture/asynchronous-processing.md section 3): a
 * future notification policy resolves the task's own title, garden name, and
 * any rendered wording itself, the same restraint
 * `RecommendationCandidateCreatedEventPayload`'s own header documents.
 */
export interface TaskAssignedEventPayload {
  readonly taskId: string;
  readonly gardenId: string;
  /** The new assignee — always present; this event is never emitted for an unassignment. */
  readonly assigneeProfileId: string;
  /** Who held the assignment immediately before this change, or `null` for a first assignment. */
  readonly previousAssigneeProfileId: string | null;
  /** The actor who performed the assign/reassign — may equal `assigneeProfileId` (self-assignment) or differ from it. */
  readonly assignedByProfileId: string;
}
