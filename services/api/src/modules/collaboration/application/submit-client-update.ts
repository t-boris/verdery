/**
 * Submits a draft update for review (P9C-PUBLISH-01):
 * `internal_draft -> ready_for_client`. Only this edge applies
 * (`publication-state.ts`); every other current state is refused with a
 * `client_update.invalid_transition` `422`, including a re-submit of an
 * already-`ready_for_client` update — this state machine has no
 * `ready_for_client -> ready_for_client` edge, so a caller retrying without
 * reusing the `Idempotency-Key` gets a clean domain error, not a silent
 * no-op (see `PublishClientUpdate`'s own header for the fuller "Task-style,
 * not Engagement-style, idempotency" reasoning this module applies
 * consistently to every revision-guarded transition).
 *
 * Requires `summary` already set — the domain-layer mirror of
 * `client_update_summary_required_check`, checked here BEFORE attempting
 * the write so the caller gets a clean, specific `summary_required` error
 * rather than discovering the same fact as a raw CHECK-violation 500.
 *
 * Revision-guarded via `applyClientUpdateRevisionGuardedUpdate`.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "10. Publication Workflow".
 */

import type { ClientUpdate as ClientUpdateResource } from '@verdery/api-contracts';
import { isValidPublicationTransition } from '../domain/publication-state.js';
import { applyClientUpdateRevisionGuardedUpdate } from './apply-client-update-revision-guarded-update.js';
import {
  clientUpdateInvalidTransitionError,
  summaryRequiredError,
} from './client-update-errors.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { ClientUpdateRepository } from './client-update-repository.js';
import { toClientUpdateResource } from './client-update-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { requireClientUpdateAndAuthorize } from './require-client-update-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.updates.submit';
const TARGET_STATE = 'ready_for_client';

export class SubmitClientUpdate {
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
    actorProfileId: Uuid,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<ClientUpdateResource> {
    await requireClientUpdateAndAuthorize(
      this.engagements,
      this.clientUpdates,
      this.publisherAuthorization,
      engagementId,
      clientUpdateId,
      actorProfileId,
    );

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, clientUpdateId, expectedRevision }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();

      const updated = await applyClientUpdateRevisionGuardedUpdate(
        context.clientUpdates,
        clientUpdateId,
        expectedRevision,
        (current) => {
          if (!isValidPublicationTransition(current.state, TARGET_STATE)) {
            throw clientUpdateInvalidTransitionError(
              `Cannot submit a client update in state "${current.state}".`,
            );
          }
          if (current.summary === null) {
            throw summaryRequiredError();
          }
          return {
            ...current,
            state: TARGET_STATE,
            submittedAt: now,
            revision: current.revision + 1,
            updatedAt: now,
          };
        },
      );

      await context.auditLogger.record({
        eventType: 'client_update.submitted',
        subjectType: 'client_update',
        subjectId: clientUpdateId,
        actorProfileId,
        actorType: 'user',
        gardenId: updated.gardenId,
        details: { engagementId },
      });
      await context.outbox.append({
        eventType: 'client_update.submitted',
        aggregateType: 'client_update',
        aggregateId: clientUpdateId,
        payload: { engagementId, gardenId: updated.gardenId },
      });

      const items = await context.clientUpdateItems.listForClientUpdate(clientUpdateId);
      return toClientUpdateResource(updated, items);
    });
  }
}
