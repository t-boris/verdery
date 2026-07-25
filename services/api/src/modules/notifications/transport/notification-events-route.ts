/**
 * Authenticated machine-to-machine notification-event endpoint
 * (P7-NOTIF-01). The workers outbox relay, not an app user, posts each
 * claimed notification-relevant `platform.outbox_event` row here,
 * authenticating with the same Google-signed service-identity token every
 * worker-to-API path presents — the exact posture
 * `media-processing-callback-route.ts` established: outside the Firebase
 * user-authenticated route group, outside public OpenAPI (the body
 * contract lives in `@verdery/api-contracts`' `notification-dispatch.ts`),
 * verified inside the handler.
 *
 * 200 tells the relay the event is durably processed (it then marks the
 * outbox row published); any error leaves the row unpublished for the next
 * tick — so this handler is duplicate-safe by the policy's own dedup
 * design, never by trusting single delivery.
 */

import type { NotificationDomainEventEnvelope } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import type { ApplyNotificationPolicy } from '../application/apply-notification-policy.js';

export interface NotificationEventsRouteDependencies {
  readonly applyNotificationPolicy: ApplyNotificationPolicy;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

/** Shape-checks the envelope; the use case validates the ids and payload semantics itself. */
function requireEnvelope(request: FastifyRequest): NotificationDomainEventEnvelope {
  const body = request.body as Partial<NotificationDomainEventEnvelope> | undefined;

  if (
    typeof body?.id !== 'string' ||
    typeof body.eventType !== 'string' ||
    body.payload === undefined ||
    (body.traceId !== null && typeof body.traceId !== 'string') ||
    typeof body.occurredAt !== 'string'
  ) {
    throw invalid(
      'The event envelope is missing required fields.',
      'notification.event.envelope_invalid',
      '/',
    );
  }

  return body as NotificationDomainEventEnvelope;
}

export function registerNotificationEventsRoute(
  app: FastifyInstance,
  dependencies: NotificationEventsRouteDependencies,
): void {
  app.post('/internal/notifications/events', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);

    const envelope = requireEnvelope(request);
    const summary = await dependencies.applyNotificationPolicy.execute(envelope);

    // One structured line per processed event — notifications.md section
    // 15's "intent creation, suppression reason" counters at their source.
    // Counts and the event id only, never recipient identities.
    request.log.info(
      {
        event: 'notifications.event_processed',
        sourceEventId: envelope.id,
        eventType: summary.eventType,
        recipientsConsidered: summary.recipientsConsidered,
        intentsCreated: summary.intentsCreated,
        intentsDeduplicated: summary.intentsDeduplicated,
        priorIntentsSuperseded: summary.priorIntentsSuperseded,
        suppressed: summary.suppressed,
      },
      'Notification event processed',
    );

    return reply.status(200).send(summary);
  });
}
