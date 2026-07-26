/**
 * The task aggregate: a manual (this pass, always `source: 'manual'`) unit of
 * garden work, its target (the whole garden, one garden area, or one plant),
 * its schedule, and its lifecycle.
 *
 * Mirrors `tasks_recommendations.task` exactly, the same way `plants-inventory`'s
 * `Plant` (domain/plant.ts) mirrors `plants_inventory.plant`: a single integer
 * `revision` column, optimistic-concurrency-guarded, journaled on every
 * accepted command — see `application/apply-task-revision-guarded-update.ts`
 * and `application/task-revision-journal-writer.ts`.
 *
 * `status` transitions live in a separate file, `task-lifecycle.ts`, mirroring
 * how gardens-mapping splits `map-object.ts` from `map-object-lifecycle.ts`
 * and plants-inventory splits `plant.ts` from `plant-lifecycle.ts`.
 * `updateTaskDetails` below still lives here (not in `task-lifecycle.ts`)
 * because it changes scheduling/detail fields, not `status` itself — but it
 * shares that file's `requireEditableStatus` gate, since editing is only
 * legal from the same two statuses a terminal transition is.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `tasks_recommendations.task`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { requireEditableStatus } from './task-lifecycle.js';
import type { TaskStatus } from './task-lifecycle.js';

export type TaskTargetKind = 'garden' | 'garden_area' | 'plant';
export type TaskUrgency = 'low' | 'normal' | 'high' | 'urgent';
/** Always `'manual'` for every task this module creates — see `CreateManualTask`'s own doc comment and the migration's comment on `task.source`. */
export type TaskSource = 'manual' | 'suggested';

const MAX_TITLE_LENGTH = 200;
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A task's target, mirroring the migration's own `task_target_consistency_check`
 * exactly: `kind: 'garden'` sets neither id, `kind: 'garden_area'` sets only
 * `gardenAreaMapObjectId`, `kind: 'plant'` sets only `plantId`. Validated by
 * `validateTaskTarget` below (shape/consistency, pure) and, separately, by
 * `application/require-task-target-references.ts` (existence, requires IO) —
 * the same split `PlantPlacement` and `require-plant-placement-in-garden.ts`
 * use for an analogous reference.
 */
export interface TaskTarget {
  readonly kind: TaskTargetKind;
  readonly gardenAreaMapObjectId: Uuid | null;
  readonly plantId: Uuid | null;
}

export interface TaskTimeWindow {
  readonly start: Date | null;
  readonly end: Date | null;
}

export interface Task {
  readonly id: Uuid;
  /** Denormalized from the target — see the migration's own comment on `task.garden_id` for why. Immutable after creation: this module has no "move task to a different target/garden" command. */
  readonly gardenId: Uuid;
  readonly targetKind: TaskTargetKind;
  readonly targetGardenAreaMapObjectId: Uuid | null;
  readonly targetPlantId: Uuid | null;
  readonly title: string;
  readonly notes: string | null;
  readonly status: TaskStatus;
  /** Calendar date only, `'YYYY-MM-DD'` — never reinterpreted through a timezone, the same convention `Plant.acquisitionDate` documents. See `platform/database/pg-date-parser.ts`. */
  readonly dueDate: string | null;
  readonly timeWindowStart: Date | null;
  readonly timeWindowEnd: Date | null;
  /** Stored only, never parsed, expanded, or validated this pass — see the migration's own comment on `task.recurrence_rule`. */
  readonly recurrenceRule: string | null;
  readonly urgency: TaskUrgency;
  readonly source: TaskSource;
  /** Set only at creation, by `CreateManualTask` — never by `CompleteTask` or any other command. See the migration's own comment on `task.origin_observation_id`. */
  readonly originObservationId: Uuid | null;
  /**
   * The recommendation candidate this task was converted from — set only
   * by `createTaskFromRecommendation` below (P7-BE-01's conversion
   * command), always together with `source: 'suggested'`: the migration's
   * `task_origin_recommendation_consistency_check` requires exactly that
   * pairing, in both directions. `createTask` hardcodes `null` alongside
   * `source: 'manual'`. Column added by
   * migrations/1785600000000_recommendations-baseline.sql, completing the
   * FK the Phase 4 baseline migration explicitly deferred.
   */
  readonly originRecommendationId: Uuid | null;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set only by a `CompleteTask` transition to `'completed'`; `null` otherwise, and never cleared once set. */
  readonly completedAt: Date | null;
  /**
   * The garden member responsible for this task (P9A-TASK-01) — `null` means
   * unassigned. Set only by `AssignTask`, together with `assignedAt`
   * (`task_assignment_linkage_check`). References `identity_access.profile`,
   * never `collaboration.membership`, the same choice `completedByProfileId`
   * documents below — an assignment stays readable after the assignee loses
   * garden access.
   */
  readonly assignedProfileId: Uuid | null;
  /** Present exactly when `assignedProfileId` is — see the migration's `task_assignment_linkage_check`. */
  readonly assignedAt: Date | null;
  /**
   * The ACTUAL caller who completed this task (P9A-TASK-01) — set by
   * `CompleteTask` from its own `profileId` argument, never from
   * `assignedProfileId` (the assignee and the completer are not required to
   * be the same profile). References `identity_access.profile` for the same
   * survives-access-loss reason `assignedProfileId` documents; the
   * migration's `task_completion_attribution_check` only requires that a
   * completion instant exist alongside it, never the reverse, so a
   * completion recorded before this column existed simply carries no
   * attribution.
   */
  readonly completedByProfileId: Uuid | null;
}

/**
 * Trims and validates a proposed title — the same gap `Plant.displayName`'s
 * `validateDisplayName` closes for its own required-text field: `title`
 * carries only `NOT NULL` in the migration, no `CHECK`, so a string of only
 * spaces would satisfy that while still being useless.
 */
export function validateTaskTitle(rawTitle: string): string {
  const title = rawTitle.trim();

  if (title.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'title must not be blank.', {
      details: [{ code: 'tasks_recommendations.task.title.blank', pointer: '/title' }],
    });
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `title must be at most ${String(MAX_TITLE_LENGTH)} characters.`,
      { details: [{ code: 'tasks_recommendations.task.title.too_long', pointer: '/title' }] },
    );
  }

  return title;
}

/**
 * Enforces the migration's `task_target_consistency_check` invariant one
 * level up, at the point a clean `ValidationError` can still be raised
 * instead of a raw `CHECK` violation — the same judgment
 * `validateQuantityForGroupingKind` documents for its own analogous
 * database-mirroring check.
 */
export function validateTaskTarget(target: TaskTarget): TaskTarget {
  const consistent =
    (target.kind === 'garden' &&
      target.gardenAreaMapObjectId === null &&
      target.plantId === null) ||
    (target.kind === 'garden_area' &&
      target.gardenAreaMapObjectId !== null &&
      target.plantId === null) ||
    (target.kind === 'plant' && target.plantId !== null && target.gardenAreaMapObjectId === null);

  if (!consistent) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "target must set gardenAreaMapObjectId only for kind 'garden_area', plantId only for kind 'plant', and neither for kind 'garden'.",
      { details: [{ code: 'tasks_recommendations.task.target.inconsistent', pointer: '/target' }] },
    );
  }

  return target;
}

/** Rejects a malformed calendar date before it becomes a raw driver error against the `date`-typed column — the same gap `Plant`'s `validateAcquisitionDate` closes for its own `date` column. Postgres itself still rejects an invalid real date (`'2026-02-30'`); this only catches the wrong shape. */
export function validateDueDate(rawDueDate: string): string {
  if (!DUE_DATE_PATTERN.test(rawDueDate)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "dueDate must be a calendar date in 'YYYY-MM-DD' form.",
      { details: [{ code: 'tasks_recommendations.task.due_date.invalid', pointer: '/dueDate' }] },
    );
  }

  return rawDueDate;
}

/** Not a database-enforced invariant (the migration places no `CHECK` across `time_window_start`/`time_window_end`), but an obvious application-layer one: a window that ends before it starts can never be satisfied. */
export function validateTimeWindow(window: TaskTimeWindow): TaskTimeWindow {
  if (
    window.start !== null &&
    window.end !== null &&
    window.start.getTime() > window.end.getTime()
  ) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'timeWindow.start must not be after timeWindow.end.',
      {
        details: [
          { code: 'tasks_recommendations.task.time_window.invalid', pointer: '/timeWindow' },
        ],
      },
    );
  }

  return window;
}

export interface CreateTaskInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly target: TaskTarget;
  readonly rawTitle: string;
  readonly notes: string | null;
  readonly rawDueDate: string | null;
  readonly timeWindowStart: Date | null;
  readonly timeWindowEnd: Date | null;
  readonly urgency: TaskUrgency;
  /** Only `CreateManualTask` ever sets this — see `Task.originObservationId`'s own doc comment. */
  readonly originObservationId: Uuid | null;
  readonly createdByProfileId: Uuid;
  readonly now: Date;
}

/**
 * Constructs a new, always-`'manual'`, always-`'planned'` task. `recurrenceRule`
 * is not a constructor parameter: no command in this module sets it at
 * creation, only `EditTask`/`RescheduleTask` (via `updateTaskDetails` below)
 * ever populate it, matching "stored only, never parsed, expanded, or
 * validated this pass."
 */
export function createTask(input: CreateTaskInput): Task {
  const target = validateTaskTarget(input.target);
  const timeWindow = validateTimeWindow({
    start: input.timeWindowStart,
    end: input.timeWindowEnd,
  });

  return {
    id: input.id,
    gardenId: input.gardenId,
    targetKind: target.kind,
    targetGardenAreaMapObjectId: target.gardenAreaMapObjectId,
    targetPlantId: target.plantId,
    title: validateTaskTitle(input.rawTitle),
    notes: input.notes,
    status: 'planned',
    dueDate: input.rawDueDate === null ? null : validateDueDate(input.rawDueDate),
    timeWindowStart: timeWindow.start,
    timeWindowEnd: timeWindow.end,
    recurrenceRule: null,
    urgency: input.urgency,
    source: 'manual',
    originObservationId: input.originObservationId,
    originRecommendationId: null,
    revision: 1,
    createdByProfileId: input.createdByProfileId,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
    assignedProfileId: null,
    assignedAt: null,
    completedByProfileId: null,
  };
}

export interface CreateTaskFromRecommendationInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly target: TaskTarget;
  /** The rule version's own `actionTitle` — section 5's "Suggested action template" becoming the concrete task title. */
  readonly rawTitle: string;
  /** The candidate's stored deterministic explanation, carried onto the task so FR-24's "Reason" survives the conversion. */
  readonly notes: string | null;
  readonly timeWindowStart: Date | null;
  readonly timeWindowEnd: Date | null;
  readonly urgency: TaskUrgency;
  readonly originRecommendationId: Uuid;
  readonly createdByProfileId: Uuid;
  readonly now: Date;
}

/**
 * Constructs the task a recommendation candidate converts into (P7-BE-01,
 * FR-25's "The application may suggest tasks from ... recommendations"):
 * `source: 'suggested'` with `originRecommendationId` set together — the
 * two halves the migration's `task_origin_recommendation_consistency_check`
 * requires as one equivalence — and `status: 'planned'`, because the USER
 * explicitly asked for the conversion: this is accepted, committed work,
 * not a proposal awaiting acceptance (the `'suggested'` STATUS models the
 * latter and nothing produces it yet). Target, urgency, and time window
 * carry over from the candidate verbatim; `dueDate` stays `null` (the
 * candidate's schedule is its window, and no calendar date is invented).
 */
export function createTaskFromRecommendation(input: CreateTaskFromRecommendationInput): Task {
  const target = validateTaskTarget(input.target);
  const timeWindow = validateTimeWindow({
    start: input.timeWindowStart,
    end: input.timeWindowEnd,
  });

  return {
    id: input.id,
    gardenId: input.gardenId,
    targetKind: target.kind,
    targetGardenAreaMapObjectId: target.gardenAreaMapObjectId,
    targetPlantId: target.plantId,
    title: validateTaskTitle(input.rawTitle),
    notes: input.notes,
    status: 'planned',
    dueDate: null,
    timeWindowStart: timeWindow.start,
    timeWindowEnd: timeWindow.end,
    recurrenceRule: null,
    urgency: input.urgency,
    source: 'suggested',
    originObservationId: null,
    originRecommendationId: input.originRecommendationId,
    revision: 1,
    createdByProfileId: input.createdByProfileId,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
    assignedProfileId: null,
    assignedAt: null,
    completedByProfileId: null,
  };
}

/**
 * Fields `EditTask`/`RescheduleTask` may change, via the shared
 * `updateTaskDetails` function below. `undefined` means "leave unchanged";
 * for the nullable fields, an explicit `null` clears it — the same
 * `undefined`-vs-`null` convention `PlantDetailsChanges` documents for its
 * own analogous shape. `RescheduleTask` only ever populates `dueDate`/
 * `timeWindowStart`/`timeWindowEnd`, leaving the rest `undefined`; `EditTask`
 * may populate any of them. See `application/apply-task-detail-changes.ts`
 * for the shared revision-guard/journal-append logic both commands go
 * through.
 */
export interface TaskDetailChanges {
  /**
   * Every field here explicitly includes `| undefined` alongside its `?:`
   * optionality, not just the latter: `EditTask`/`RescheduleTask` build this
   * object by mapping from their own differently-shaped input (flattening a
   * nested `timeWindow`), so a field can be present with value `undefined`
   * (not merely absent) under this project's `exactOptionalPropertyTypes`
   * setting — the explicit union is what TypeScript itself asks for in that
   * case, and it changes nothing behaviorally: `updateTaskDetails` below
   * already treats "absent" and "present but undefined" identically via
   * `!== undefined` checks.
   */
  readonly title?: string | undefined;
  readonly notes?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly timeWindowStart?: Date | null | undefined;
  readonly timeWindowEnd?: Date | null | undefined;
  readonly urgency?: TaskUrgency | undefined;
  readonly recurrenceRule?: string | null | undefined;
}

/**
 * Applies `EditTask`/`RescheduleTask`'s changes. Only legal while
 * `status IN ('planned', 'suggested')` — see `requireEditableStatus`'s own
 * doc comment for why, and `TaskDetailChanges`'s doc comment for how
 * `RescheduleTask` reuses this same function with a narrower `changes` value
 * rather than a duplicated revision-guard/journal-append path.
 */
export function updateTaskDetails(task: Task, changes: TaskDetailChanges, now: Date): Task {
  requireEditableStatus(task);

  const title = changes.title !== undefined ? validateTaskTitle(changes.title) : task.title;
  const dueDate =
    changes.dueDate !== undefined
      ? changes.dueDate === null
        ? null
        : validateDueDate(changes.dueDate)
      : task.dueDate;
  const timeWindowStart =
    changes.timeWindowStart !== undefined ? changes.timeWindowStart : task.timeWindowStart;
  const timeWindowEnd =
    changes.timeWindowEnd !== undefined ? changes.timeWindowEnd : task.timeWindowEnd;
  validateTimeWindow({ start: timeWindowStart, end: timeWindowEnd });

  return {
    ...task,
    title,
    notes: changes.notes !== undefined ? changes.notes : task.notes,
    dueDate,
    timeWindowStart,
    timeWindowEnd,
    urgency: changes.urgency !== undefined ? changes.urgency : task.urgency,
    recurrenceRule:
      changes.recurrenceRule !== undefined ? changes.recurrenceRule : task.recurrenceRule,
    revision: task.revision + 1,
    updatedAt: now,
  };
}

/**
 * Assigns, reassigns, or unassigns (`assigneeProfileId: null`) a task
 * (P9A-TASK-01). One function for all three: reassignment is the same
 * operation applied again, and unassignment is the same operation applied
 * with `null` — the migration's `task_assignment_linkage_check` requires
 * `assignedProfileId`/`assignedAt` to be present or absent together, which
 * this function keeps true by construction rather than by a caller
 * remembering to clear both.
 *
 * Gated by `requireEditableStatus`, the same precondition every other
 * task-changing command in this module shares: assigning work to, or taking
 * work away from, a task that is already terminal (completed, skipped,
 * dismissed, deleted) has no meaning.
 *
 * WHO may be named as `assigneeProfileId` is an application-layer concern,
 * not a domain one — this function only shapes the task's own state.
 * `AssignTask` (application layer) is what checks the assignee holds
 * `editGardenContent` on this task's garden before ever calling this
 * function, per docs/development/garden-capability-matrix.md row B14.
 */
export function assignTask(task: Task, assigneeProfileId: Uuid | null, now: Date): Task {
  requireEditableStatus(task);

  return {
    ...task,
    assignedProfileId: assigneeProfileId,
    assignedAt: assigneeProfileId === null ? null : now,
    revision: task.revision + 1,
    updatedAt: now,
  };
}
