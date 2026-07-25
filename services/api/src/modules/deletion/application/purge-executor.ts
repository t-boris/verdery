import type { PurgePreparation, PurgeStep } from './purge-plan.js';

/**
 * Executes one step of a purge plan against the database.
 *
 * A port rather than inline Kysely for one reason: this is the only place in
 * the service that issues an unrestricted `DELETE` across another module's
 * tables, and naming it as a boundary makes that visible in the composition
 * root instead of buried in a use case.
 */
export interface PurgeExecutor {
  /**
   * Deletes every row `step` claims for `subjectId`, in batches of at most
   * `batchSize`, and returns how many rows went. Loops until a batch comes
   * back short, so one call fully drains one step.
   */
  deleteAll(step: PurgeStep, subjectId: string, batchSize: number): Promise<number>;

  /** Runs a preparation statement (a reference-cycle release), returning rows touched. */
  prepare(preparation: PurgePreparation, subjectId: string): Promise<number>;
}
