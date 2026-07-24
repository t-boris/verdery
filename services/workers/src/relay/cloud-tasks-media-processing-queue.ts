/**
 * `@google-cloud/tasks`-backed `MediaProcessingQueue`.
 *
 * `@google-cloud/tasks` is a new dependency this stage adds to this
 * package — the same class of "architecturally critical, ADR-0002-covered"
 * addition `@google-cloud/storage` was for `services/api` in the
 * immediately-preceding stage (P6-PLAT-01/P6-API-01): ADR-0002 already
 * commits this project to the Google Cloud/Firebase platform broadly, and
 * ADR-0006 names Cloud Tasks explicitly as the primitive for "explicitly
 * targeted commands with scheduling, rate control, and bounded retries" —
 * exactly what enqueueing one media-processing job per media record is.
 * Applying the identical reasoning already used for `@google-cloud/storage`
 * rather than re-litigating it from scratch.
 *
 * Authenticates through Application Default Credentials only — this
 * package's own runtime service account's identity, or a developer's
 * `gcloud auth application-default login` locally — matching every other
 * Google Cloud client in this monorepo (see `services/api/src/main.ts`'s own
 * comment on `firebase-admin`) and architecture/media-storage-and-
 * processing.md section "18. Security": "No long-lived service-account
 * keys."
 *
 * Task names are deterministic, derived from `message.taskName` (== the
 * triggering outbox event's own id): `createTask` with an explicit `name`
 * is Cloud Tasks' own documented deduplication mechanism (architecture/
 * asynchronous-processing.md section "5. Cloud Tasks": "Task names may
 * derive from a stable operation ID when deduplication behavior is
 * required"). A second `enqueue` call with the same `taskName` receives
 * `ALREADY_EXISTS` from Cloud Tasks, treated here as success, never
 * surfaced as a failure — the concrete mechanism behind "a relay run twice
 * must not enqueue the same event twice."
 *
 * Source: architecture/decisions/ADR-0002-firebase-google-cloud-and-postgresql.md;
 * architecture/decisions/ADR-0006-google-cloud-asynchronous-primitives.md;
 * architecture/asynchronous-processing.md, section "5. Cloud Tasks".
 */

import type { CloudTasksClient } from '@google-cloud/tasks';
import type {
  MediaProcessingQueue,
  MediaProcessingQueueMessage,
} from './media-processing-queue.js';

/** The gRPC status code Cloud Tasks returns when a task with this exact name already exists. */
const GRPC_ALREADY_EXISTS = 6;

interface GrpcErrorLike {
  readonly code?: number;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as GrpcErrorLike).code === GRPC_ALREADY_EXISTS
  );
}

export class CloudTasksMediaProcessingQueue implements MediaProcessingQueue {
  constructor(
    private readonly client: CloudTasksClient,
    /** `projects/{project}/locations/{location}/queues/{queue}`. */
    private readonly queuePath: string,
    /** The validation-worker route base URL; the job id is appended per task. */
    private readonly taskUrl: string,
    private readonly invokerServiceAccountEmail: string,
  ) {}

  async enqueue(message: MediaProcessingQueueMessage): Promise<void> {
    const taskName = `${this.queuePath}/tasks/${message.taskName}`;

    try {
      await this.client.createTask({
        parent: this.queuePath,
        task: {
          name: taskName,
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.taskUrl}/${message.manifest.jobId}`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(message.manifest)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: this.invokerServiceAccountEmail,
              audience: this.taskUrl,
            },
          },
        },
      });
    } catch (error) {
      if (isAlreadyExists(error)) {
        return;
      }
      throw error;
    }
  }
}
