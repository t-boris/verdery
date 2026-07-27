/**
 * Lists the engagement garden's work logs, most recently occurred first
 * (P9C-PUBLISH-01) — the candidate list a publisher selects completed work
 * from when staging a `client_update`. Publisher-only: no new authorization
 * machinery beyond what preparing a client update already requires (see
 * this module's own task framing).
 */

import type { WorkLogListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { PublisherAuthorization } from './publisher-authorization.js';
import type { WorkLogRepository } from './work-log-repository.js';
import { toWorkLogResource } from './work-log-view.js';

export class ListEngagementWorkLogs {
  constructor(
    private readonly engagements: ClientEngagementRepository,
    private readonly workLogs: WorkLogRepository,
    private readonly publisherAuthorization: PublisherAuthorization,
  ) {}

  async execute(engagementId: Uuid, actorProfileId: Uuid): Promise<WorkLogListResult> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await this.publisherAuthorization.requireActiveGrant(engagementId, actorProfileId);

    const items = await this.workLogs.listForGarden(engagement.gardenId);

    return { items: items.map(toWorkLogResource) };
  }
}
