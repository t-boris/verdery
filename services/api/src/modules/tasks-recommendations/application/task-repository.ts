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
}
