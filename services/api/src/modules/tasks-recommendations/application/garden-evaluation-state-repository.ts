/**
 * Port for the sweep's own bookkeeping: when each garden was last
 * evaluated.
 *
 * Written INSIDE the evaluation transaction, deliberately. The two failure
 * orderings are not symmetric: a committed evaluation whose watermark write
 * failed is simply re-evaluated next tick and converges to the same state,
 * while a watermark written for an evaluation that then rolled back would
 * make the sweep skip a garden it never actually looked at — a silent miss
 * bounded only by the staleness floor. Sharing the transaction removes the
 * second case entirely.
 *
 * Source: migrations/1789200000000_garden-evaluation-watermark.sql.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface GardenEvaluationStateRepository {
  /** Upserts the garden's watermark to `evaluatedAt` — the injected clock's reading, never `now()`. */
  recordEvaluated(gardenId: Uuid, evaluatedAt: Date): Promise<void>;
}
