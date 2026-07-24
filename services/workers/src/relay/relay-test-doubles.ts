/**
 * Shared in-memory test doubles for the relay's own unit tests — mirrors
 * `services/api`'s established "one shared file, not N copies" convention
 * (see `media-test-doubles.ts` there).
 *
 * Not itself a `*.test.ts` file, so vitest never runs it as a suite.
 */

import type { Logger } from '../logger.js';
import type {
  MediaProcessingQueue,
  MediaProcessingQueueMessage,
} from './media-processing-queue.js';
import type { OutboxEventRecord, OutboxEventStore } from './outbox-event-store.js';
import type {
  EnsureRequestedInput,
  ProcessingJobStore,
  RelayProcessingJob,
} from './processing-job-store.js';
import type { Clock } from './outbox-relay.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

export class FakeOutboxEventStore implements OutboxEventStore {
  readonly rows = new Map<string, { record: OutboxEventRecord; publishedAt: Date | null }>();
  readonly markPublishedCalls: string[] = [];

  seed(record: OutboxEventRecord): void {
    this.rows.set(record.id, { record, publishedAt: null });
  }

  claimUnpublished(limit: number): Promise<readonly OutboxEventRecord[]> {
    const unpublished = [...this.rows.values()]
      .filter((entry) => entry.publishedAt === null)
      .map((entry) => entry.record)
      .slice(0, limit);
    return Promise.resolve(unpublished);
  }

  markPublished(id: string, now: Date): Promise<void> {
    this.markPublishedCalls.push(id);
    const entry = this.rows.get(id);
    if (entry !== undefined) {
      entry.publishedAt = now;
    }
    return Promise.resolve();
  }
}

export class FakeProcessingJobStore implements ProcessingJobStore {
  readonly jobs = new Map<string, RelayProcessingJob>();
  readonly ensureRequestedCalls: EnsureRequestedInput[] = [];
  readonly markQueuedCalls: string[] = [];

  /** Test setup helper: seeds a job as if a previous tick already created it. */
  seed(job: RelayProcessingJob): void {
    this.jobs.set(job.id, job);
  }

  ensureRequested(input: EnsureRequestedInput): Promise<RelayProcessingJob> {
    this.ensureRequestedCalls.push(input);
    const existing = this.jobs.get(input.id);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    const created: RelayProcessingJob = {
      id: input.id,
      mediaId: input.mediaId,
      processorConfigVersion: input.processorConfigVersion,
      state: 'requested',
    };
    this.jobs.set(input.id, created);
    return Promise.resolve(created);
  }

  markQueued(id: string): Promise<void> {
    this.markQueuedCalls.push(id);
    const job = this.jobs.get(id);
    if (job !== undefined && job.state === 'requested') {
      this.jobs.set(id, { ...job, state: 'queued' });
    }
    return Promise.resolve();
  }
}

export class FakeMediaProcessingQueue implements MediaProcessingQueue {
  readonly enqueued: MediaProcessingQueueMessage[] = [];
  private readonly seenTaskNames = new Set<string>();
  rejectNextWith: Error | null = null;

  enqueue(message: MediaProcessingQueueMessage): Promise<void> {
    if (this.rejectNextWith !== null) {
      const error = this.rejectNextWith;
      this.rejectNextWith = null;
      return Promise.reject(error);
    }

    // Mirrors the real adapter's own "ALREADY_EXISTS is success" idempotency
    // — a repeated taskName is recorded once, never rejected.
    if (!this.seenTaskNames.has(message.taskName)) {
      this.seenTaskNames.add(message.taskName);
      this.enqueued.push(message);
    }
    return Promise.resolve();
  }
}

export function silentLogger(): Logger {
  const noop = (): void => {
    /* no-op */
  };
  return {
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  } as unknown as Logger;
}
