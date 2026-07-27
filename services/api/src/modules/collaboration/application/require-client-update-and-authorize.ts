/**
 * Fetches the engagement and client update a client-update-scoped command
 * targets, authorizing the caller's ACTIVE publisher grant in between — the
 * same two-step "look up, then authorize, then look up the nested resource"
 * shape `requireTaskAndAuthorize` establishes for tasks-recommendations,
 * adapted for a path that already names BOTH ids
 * (`/client-engagements/{engagementId}/updates/{clientUpdateId}`) rather
 * than deriving the second from the first.
 *
 * Runs against the pooled connection, not a transaction — the same
 * before-the-transaction placement `requireTaskAndAuthorize` uses, so a
 * caller lacking publisher access never reaches the idempotency check or
 * opens a transaction at all.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ClientEngagementDetail,
  ClientEngagementRepository,
} from './client-engagement-repository.js';
import type { ClientUpdateDetail, ClientUpdateRepository } from './client-update-repository.js';
import { clientUpdateNotFoundError, engagementNotFoundError } from './client-update-errors.js';
import type { PublisherAuthorization } from './publisher-authorization.js';

export interface ClientUpdateAndEngagement {
  readonly engagement: ClientEngagementDetail;
  readonly clientUpdate: ClientUpdateDetail;
}

export async function requireClientUpdateAndAuthorize(
  engagements: ClientEngagementRepository,
  clientUpdates: ClientUpdateRepository,
  publisherAuthorization: PublisherAuthorization,
  engagementId: Uuid,
  clientUpdateId: Uuid,
  actorProfileId: Uuid,
): Promise<ClientUpdateAndEngagement> {
  const engagement = await engagements.findById(engagementId);
  if (engagement === null) {
    throw engagementNotFoundError();
  }

  await publisherAuthorization.requireActiveGrant(engagementId, actorProfileId);

  const clientUpdate = await clientUpdates.findByIdAndEngagement(clientUpdateId, engagementId);
  if (clientUpdate === null) {
    throw clientUpdateNotFoundError();
  }

  return { engagement, clientUpdate };
}
