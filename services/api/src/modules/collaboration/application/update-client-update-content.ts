/**
 * Edits a draft update's `title`/`summary` (P9C-PUBLISH-01) —
 * `internal_draft` only, matching the strictly linear state machine
 * (`publication-state.ts`): there is no edge back to `internal_draft`, so a
 * submitted update's content can never be re-opened for editing.
 *
 * REVISION-GUARDED, NOT "ALREADY-THERE" IDEMPOTENT — the same Task-style
 * posture `AssignTask`/`CompleteTask` already establish for a
 * revision-carrying row: the write is a strict `WHERE revision = ?`
 * conditional update with no domain-state short-circuit, relying on
 * `runIdempotentCommand`'s own idempotency-key replay for safe retries. See
 * `PublishClientUpdate`'s own header for the fuller reasoning this module
 * applies consistently across every revision-guarded client-update command.
 */

import type { ClientUpdate as ClientUpdateResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { clientUpdateContentLockedError } from './client-update-errors.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import { toClientUpdateResource } from './client-update-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import { applyClientUpdateRevisionGuardedUpdate } from './apply-client-update-revision-guarded-update.js';

const OPERATION = 'client_engagements.updates.update_content';

export interface UpdateClientUpdateContentInput {
  readonly title?: string;
  readonly summary?: string;
}

export class UpdateClientUpdateContent {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly publisherAuthorization: PublisherAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly clientUpdates: ClientUpdateRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    clientUpdateId: Uuid,
    request: UpdateClientUpdateContentInput,
    actorProfileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<ClientUpdateResource> {
    const { clientUpdate } = await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    if (clientUpdate.state !== 'internal_draft') {
      throw clientUpdateContentLockedError();
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        engagementId,
        clientUpdateId,
        expectedRevision,
        request,
      }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();

      const updated = await applyClientUpdateRevisionGuardedUpdate(
        context.clientUpdates,
        clientUpdateId,
        expectedRevision,
        (current) => {
          if (current.state !== 'internal_draft') {
            throw clientUpdateContentLockedError();
          }
          return {
            ...current,
            title: request.title ?? current.title,
            summary: request.summary ?? current.summary,
            revision: current.revision + 1,
            updatedAt: now,
          };
        },
      );

      await context.auditLogger.record({
        eventType: 'client_update.content_updated',
        subjectType: 'client_update',
        subjectId: clientUpdateId,
        actorProfileId,
        actorType: 'user',
        gardenId: updated.gardenId,
        details: { engagementId },
      });
      await context.outbox.append({
        eventType: 'client_update.content_updated',
        aggregateType: 'client_update',
        aggregateId: clientUpdateId,
        payload: { engagementId, gardenId: updated.gardenId },
      });

      const items = await context.clientUpdateItems.listForClientUpdate(clientUpdateId);
      return toClientUpdateResource(updated, items);
    });
  }
}
