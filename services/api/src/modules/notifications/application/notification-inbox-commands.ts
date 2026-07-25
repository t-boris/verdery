/**
 * The inbox view commands (P7-NOTIF-01): mark-read and dismiss.
 *
 * DELIBERATELY OUTSIDE the Idempotency-Key / If-Match conventions every
 * garden-content command follows, with the reasoning stated in the
 * contract too: both writes are set-once monotonic stamps on a
 * single-owner row (`read_at`/`dismissed_at` take their FIRST value and
 * keep it), so a retry or a concurrent duplicate converges on the same
 * state and response by construction — an idempotency record would
 * duplicate what the write already guarantees, and a revision
 * precondition would force clients to serialize inherently commutative
 * writes (two devices marking the same entry read). Garden-content
 * commands are neither single-owner nor monotonic, which is exactly why
 * they need both headers.
 *
 * NOT-FOUND CONCEALMENT: another recipient's notification id answers
 * `notification.not_found`, indistinguishable from a nonexistent id — the
 * `GardenAuthorization` posture applied to per-user rows.
 *
 * Legal in ANY lifecycle state: reading or dismissing an entry that has
 * since expired or been superseded records the view fact without
 * resurrecting the entry (inbox state and delivery state are independent
 * facts — notifications.md section 12).
 */

import { NotificationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { NotificationIntentRepository } from './notification-intent-repository.js';
import type { NotificationResource } from './notification-view.js';
import { toNotificationResource } from './notification-view.js';

function notFound(): NotFoundError {
  return new NotFoundError(NotificationErrorCode.NotFound, 'Notification not found.');
}

export class MarkNotificationRead {
  constructor(
    private readonly intents: NotificationIntentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(notificationId: Uuid, profileId: Uuid): Promise<NotificationResource> {
    const updated = await this.intents.markRead(notificationId, profileId, this.clock.now());
    if (updated === null) {
      throw notFound();
    }
    return toNotificationResource(updated);
  }
}

export class DismissNotification {
  constructor(
    private readonly intents: NotificationIntentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(notificationId: Uuid, profileId: Uuid): Promise<NotificationResource> {
    const updated = await this.intents.markDismissed(notificationId, profileId, this.clock.now());
    if (updated === null) {
      throw notFound();
    }
    return toNotificationResource(updated);
  }
}
