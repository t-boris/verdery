/**
 * Posts one claimed notification-relevant outbox event to `services/api`'s
 * `POST /v1/internal/notifications/events`, authenticated with a
 * Google-signed ID token for the SAME audience as the processing-result
 * callback and every sweep — one worker-to-API identity, never a second
 * that could drift (`GoogleApiSweepTrigger`'s own established posture).
 *
 * A non-2xx response rejects (google-auth-library's request throws), so the
 * relay counts the event failed and leaves its row unpublished for the next
 * tick — the same retry-by-redelivery model every relay path uses.
 */

import type {
  NotificationDomainEventEnvelope,
  NotificationEventProcessingSummary,
} from '@verdery/api-contracts';
import { GoogleAuth } from 'google-auth-library';
import type { NotificationEventDispatcher } from './notification-event-dispatcher.js';
import type { OutboxEventRecord } from './outbox-event-store.js';

export class GoogleApiNotificationEventDispatcher implements NotificationEventDispatcher {
  private readonly auth = new GoogleAuth();

  constructor(
    private readonly eventsUrl: string,
    private readonly audience: string,
  ) {}

  async dispatch(event: OutboxEventRecord): Promise<NotificationEventProcessingSummary> {
    const envelope: NotificationDomainEventEnvelope = {
      id: event.id,
      eventType: event.eventType,
      payload: event.payload,
      traceId: event.traceId,
      occurredAt: event.occurredAt.toISOString(),
    };

    const client = await this.auth.getIdTokenClient(this.audience);
    const response = await client.request<NotificationEventProcessingSummary>({
      method: 'POST',
      url: this.eventsUrl,
      headers: { 'Content-Type': 'application/json' },
      data: envelope,
    });

    return response.data;
  }
}
