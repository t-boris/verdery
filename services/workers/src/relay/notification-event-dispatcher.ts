/**
 * Port for forwarding one notification-relevant outbox event to
 * `services/api`'s internal notification-policy endpoint (P7-NOTIF-01).
 *
 * The relay FORWARDS these events instead of processing them because the
 * notification policy's reads — garden membership, profiles, preferences,
 * recommendation candidates — are exactly the data `verdery_worker`
 * deliberately has no database access to; this process contributes what it
 * uniquely has, the already-polling relay loop and a verified worker-to-API
 * identity (the scheduled sweeps' own privilege-boundary reasoning, applied
 * to the relay's third event family).
 *
 * A resolved promise means the API durably processed the event (created,
 * deduplicated, or policy-suppressed its intents) and the caller may mark
 * the outbox row published; a rejection leaves the row unpublished for the
 * next tick. The receiver is duplicate-safe per event, so the
 * publish-then-record crash window re-delivers harmlessly — see
 * `@verdery/api-contracts`' `notification-dispatch.ts`.
 */

import type { NotificationEventProcessingSummary } from '@verdery/api-contracts';
import type { OutboxEventRecord } from './outbox-event-store.js';

export interface NotificationEventDispatcher {
  dispatch(event: OutboxEventRecord): Promise<NotificationEventProcessingSummary>;
}
