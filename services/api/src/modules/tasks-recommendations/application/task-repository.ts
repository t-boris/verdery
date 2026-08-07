import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Task } from '../domain/task.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';

export interface TaskRepository {
  findById(taskId: Uuid): Promise<Task | null>;
  insert(task: Task): Promise<void>;

  /**
   * Writes the task's new state guarded by `expectedRevision`. Returns
   * `false` when the stored revision no longer matches, without throwing —
   * the same `boolean`-return contract `PlantRepository.update` and
   * `GardenRepository.update` already follow, letting the caller
   * (`apply-task-revision-guarded-update.ts`) decide how to report it.
   */
  update(task: Task, expectedRevision: number): Promise<boolean>;

  /**
   * Every task in the garden, optionally restricted to the given statuses,
   * ordered per `ListTasksForGarden`'s own documented choice — see that
   * file. `statusFilter: null` means "every status."
   */
  listForGarden(gardenId: Uuid, statusFilter: readonly TaskStatus[] | null): Promise<Task[]>;

  /**
   * Tasks in the garden CLOSED as `completed` at or after `since`, newest
   * first — the engine's "work actually done" input.
   *
   * Bounded by a cutoff rather than reusing `listForGarden(['completed'])`
   * on purpose: a garden accumulates completed tasks forever, and the
   * evaluation sweep runs this once per garden per pass. The engine only
   * ever needs the recent tail, so the query only ever returns it.
   */
  listCompletedSince(gardenId: Uuid, since: Date): Promise<Task[]>;
}
