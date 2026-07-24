/**
 * Port for enqueueing one media-processing job onto Cloud Tasks.
 *
 * Follows this codebase's established port-plus-adapter-plus-fake
 * convention (see `services/api/src/platform/outbox/outbox-appender.ts` for
 * the general shape this mirrors on the API side): the real adapter is
 * `cloud-tasks-media-processing-queue.ts` (`@google-cloud/tasks`-backed);
 * tests use a fake implementing this same interface.
 *
 * Source: architecture/asynchronous-processing.md, section "5. Cloud Tasks"
 * ("Task names may derive from a stable operation ID when deduplication
 * behavior is required.").
 */

import type { MediaProcessingManifest } from '@verdery/api-contracts';

export interface MediaProcessingQueueMessage {
  /**
   * The Cloud Tasks task's own deterministic name suffix, derived from the
   * triggering outbox event's id (== the job's own id — see
   * `outbox-relay.ts`'s header comment). Two `enqueue` calls with the same
   * `taskName` are safe: the real adapter treats Cloud Tasks' own
   * `ALREADY_EXISTS` response as success, not a failure to surface.
   */
  readonly taskName: string;
  readonly manifest: MediaProcessingManifest;
}

export interface MediaProcessingQueue {
  /** Idempotent under a repeated `taskName` — see `MediaProcessingQueueMessage.taskName`'s own doc comment. */
  enqueue(message: MediaProcessingQueueMessage): Promise<void>;
}
