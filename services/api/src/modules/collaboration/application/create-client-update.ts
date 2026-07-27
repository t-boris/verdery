/**
 * Creates a `client_update` in `internal_draft` (P9C-PUBLISH-01) — the
 * first of the workflow's three-to-four distinct publisher-initiated steps
 * ADR-0012 describes: "An authorized publisher prepares a `client_update`,
 * selects client-safe text and media, and publishes an immutable version."
 *
 * PUBLISHER-ONLY, gated by `PublisherAuthorization.requireActiveGrant` —
 * NEVER by `manageEngagement`/`manageGarden` alone, the entire point of the
 * separate capability. An organization admin or garden owner who
 * administers the engagement but holds no publisher grant on it gets `403`
 * here exactly like every other client-update command.
 *
 * READ-THEN-AUTHORIZE: the engagement is looked up first so a genuinely
 * unrelated caller gets `404` (existence concealed) while a caller who
 * legitimately administers the engagement but lacks a grant gets `403` —
 * see `publisher-authorization.ts`'s own header for why this distinction
 * matters and is deliberate.
 *
 * REQUIRES THE ENGAGEMENT BE `active`: a `draft`, `ended`, or `revoked`
 * engagement cannot start receiving new client updates.
 *
 * NEVER TRIGGERED BY `CompleteTask` OR ANY OTHER TASK COMMAND. No code path
 * in `tasks-recommendations` calls this — publication is always a distinct,
 * manually initiated act, never a side effect of finishing work.
 *
 * PROHIBITED-CONTENT FIX (P9C-OBS-01). `title` becomes the eventual
 * publication's own headline text once published — section 19's own
 * exclusion list names "publication text" explicitly, so the audit
 * `details` below no longer carries it (it did, prior to this package);
 * `update-client-update-content.ts`'s own audit for the identical field
 * never did, which is what this fix now matches.
 *
 * Source: implementation-plan.md work packages P9C-PUBLISH-01, P9C-OBS-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary";
 * architecture/collaboration-and-client-sharing.md, section
 * "19. Audit and Observability".
 */

import type { ClientUpdate as ClientUpdateResource } from '@verdery/api-contracts';
import { ClientUpdateErrorCode } from '@verdery/api-contracts';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import { toClientUpdateResource } from './client-update-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.updates.create';

export class CreateClientUpdate {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly publisherAuthorization: PublisherAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    title: string,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientUpdateResource> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await this.publisherAuthorization.requireActiveGrant(engagementId, actorProfileId);

    if (engagement.state !== 'active') {
      throw new DomainRuleViolatedError(
        ClientUpdateErrorCode.EngagementNotActive,
        'A client update can only be created on an active engagement.',
      );
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, title }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const now = this.clock.now();
      const id = generateUuidV7();

      await context.clientUpdates.insert({
        id,
        engagementId,
        gardenId: engagement.gardenId,
        title,
        createdByProfileId: actorProfileId,
        now,
      });

      await context.auditLogger.record({
        eventType: 'client_update.created',
        subjectType: 'client_update',
        subjectId: id,
        actorProfileId,
        actorType: 'user',
        gardenId: engagement.gardenId,
        details: { engagementId },
      });
      await context.outbox.append({
        eventType: 'client_update.created',
        aggregateType: 'client_update',
        aggregateId: id,
        payload: { engagementId, gardenId: engagement.gardenId },
      });

      return toClientUpdateResource(
        {
          id,
          engagementId,
          gardenId: engagement.gardenId,
          state: 'internal_draft',
          title,
          summary: null,
          revision: 1,
          createdByProfileId: actorProfileId,
          submittedAt: null,
          publishedAt: null,
          publishedByProfileId: null,
          withdrawnAt: null,
          withdrawnByProfileId: null,
          withdrawnReason: null,
          createdAt: now,
          updatedAt: now,
        },
        [],
      );
    });
  }
}
