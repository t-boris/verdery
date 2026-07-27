/**
 * Withdraws a published update (P9C-PUBLISH-01): `published -> withdrawn`.
 * A true terminal — nothing un-withdraws it. Only this edge applies
 * (`publication-state.ts`); refused with `422` from any other state.
 * Revision-guarded, mirroring `SubmitClientUpdate`/`PublishClientUpdate`'s
 * own posture.
 *
 * NEVER TOUCHES `publication_version`, its items, or `media_entitlement` —
 * withdrawal is a `client_update.state` transition ONLY. This matches the
 * P9C-DATA-01 migration's own design note ("WITHDRAWAL NEVER TOUCHES
 * `media_entitlement`, AND THAT IS THE DESIGN, NOT A GAP"): the immutable
 * publication rows and their entitlements survive untouched, preserving the
 * audit/dispute record; a client-facing read path (P9C-API-01/P9C-MEDIA-01,
 * out of this package's scope) is what must join through
 * `client_update.state` and stop surfacing a withdrawn update's content —
 * this command's own job ends at recording the withdrawal itself.
 *
 * PROHIBITED-CONTENT FIX (P9C-OBS-01). `reason` is documented, free text
 * ("Optional free-text reason, stored as `withdrawn_reason`" — the
 * contract's own words) — this command's audit `details` never carries it,
 * only whether one was given (`hasReason`), the identical "presence
 * boolean, never the value" convention `notifications.preferences_updated`
 * already established (`hasQuietHours`). Section 19's own exclusion list
 * names "notes" explicitly; a withdrawal reason is exactly that.
 *
 * Source: implementation-plan.md work packages P9C-PUBLISH-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "10. Publication Workflow", "19. Audit and Observability".
 */

import type { ClientUpdate as ClientUpdateResource } from '@verdery/api-contracts';
import { isValidPublicationTransition } from '../domain/publication-state.js';
import { applyClientUpdateRevisionGuardedUpdate } from './apply-client-update-revision-guarded-update.js';
import { clientUpdateInvalidTransitionError } from './client-update-errors.js';
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

const OPERATION = 'client_engagements.updates.withdraw';
const TARGET_STATE = 'withdrawn';

export class WithdrawClientUpdate {
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
    reason: string | null,
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
      requestFingerprint: JSON.stringify({
        engagementId,
        clientUpdateId,
        expectedRevision,
        reason,
      }),
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
              `Cannot withdraw a client update in state "${current.state}".`,
            );
          }
          return {
            ...current,
            state: TARGET_STATE,
            withdrawnAt: now,
            withdrawnByProfileId: actorProfileId,
            withdrawnReason: reason,
            revision: current.revision + 1,
            updatedAt: now,
          };
        },
      );

      await context.auditLogger.record({
        eventType: 'client_update.withdrawn',
        subjectType: 'client_update',
        subjectId: clientUpdateId,
        actorProfileId,
        actorType: 'user',
        gardenId: updated.gardenId,
        details: { engagementId, hasReason: reason !== null },
      });
      await context.outbox.append({
        eventType: 'client_update.withdrawn',
        aggregateType: 'client_update',
        aggregateId: clientUpdateId,
        payload: { engagementId, gardenId: updated.gardenId },
      });

      const items = await context.clientUpdateItems.listForClientUpdate(clientUpdateId);
      return toClientUpdateResource(updated, items);
    });
  }
}
