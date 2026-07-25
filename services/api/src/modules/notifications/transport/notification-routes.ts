/**
 * Notification inbox and preference HTTP routes (P7-NOTIF-01) — the
 * `Notifications` tag: the inbox list, the two idempotent-by-design view
 * commands (read/dismiss — see `notification-inbox-commands.ts`'s header
 * for why they take neither `Idempotency-Key` nor `If-Match`), and the
 * preference document read/replace. Hand-validated against the OpenAPI
 * document like every sibling transport, reusing `garden-routes.ts`'
 * exported helpers.
 *
 * Every route is scoped to the AUTHENTICATED caller — no path names
 * another profile, so authorization is the session itself plus, for
 * garden-scoped preference entries, the membership check the use case
 * performs.
 */

import { IF_MATCH_HEADER } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  invalid,
  requireIdempotencyKey,
  UUID_PATTERN,
} from '../../gardens-mapping/transport/garden-routes.js';
import { isValidIanaTimeZone, MINUTES_PER_DAY } from '../domain/quiet-hours.js';
import type {
  DismissNotification,
  MarkNotificationRead,
} from '../application/notification-inbox-commands.js';
import type {
  GetNotificationPreferences,
  UpdateNotificationPreferences,
  UpdateNotificationPreferencesInput,
} from '../application/notification-preference-commands.js';
import type { ListNotifications } from '../application/list-notifications.js';

export interface NotificationRoutesDependencies {
  readonly listNotifications: ListNotifications;
  readonly markNotificationRead: MarkNotificationRead;
  readonly dismissNotification: DismissNotification;
  readonly getNotificationPreferences: GetNotificationPreferences;
  readonly updateNotificationPreferences: UpdateNotificationPreferences;
}

const INBOX_DEFAULT_LIMIT = 50;
const INBOX_MAX_LIMIT = 100;

function requireNotificationId(request: FastifyRequest): string {
  const { notificationId } = request.params as { notificationId?: unknown };

  if (typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)) {
    throw invalid(
      'notificationId must be a UUID.',
      'request.notification_id.invalid',
      '/notificationId',
    );
  }

  return notificationId;
}

function parseInboxQuery(request: FastifyRequest): { cursor: string | null; limit: number } {
  const query = request.query as { cursor?: unknown; limit?: unknown };

  const cursor = typeof query.cursor === 'string' && query.cursor.length > 0 ? query.cursor : null;

  if (query.limit === undefined) {
    return { cursor, limit: INBOX_DEFAULT_LIMIT };
  }

  const limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > INBOX_MAX_LIMIT) {
    throw invalid(
      `limit must be between 1 and ${String(INBOX_MAX_LIMIT)}.`,
      'request.limit.invalid',
      '/limit',
    );
  }

  return { cursor, limit };
}

/**
 * The preference document's `If-Match` accepts `"0"` — the revision of a
 * never-written document (the contract operation documents this as the one
 * zero-revision resource) — so the shared `requireExpectedRevision`
 * (positive integers only) deliberately does not apply here.
 */
function requireDocumentRevision(request: FastifyRequest): number {
  const raw = request.headers[IF_MATCH_HEADER];
  const unquoted = typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : '';
  const revision = Number(unquoted);

  if (typeof raw !== 'string' || !Number.isInteger(revision) || revision < 0) {
    throw invalid(
      `${IF_MATCH_HEADER} header must be a quoted non-negative integer revision.`,
      'request.if_match.invalid',
      `/headers/${IF_MATCH_HEADER}`,
    );
  }

  return revision;
}

function requireMinute(value: unknown, pointer: string): number {
  const minute = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw invalid('must be an integer between 0 and 1439.', 'request.invalid', pointer);
  }
  return minute;
}

function parsePreferencesBody(body: unknown): UpdateNotificationPreferencesInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('the request body must be an object.', 'request.invalid', '');
  }
  const { quietHours, entries } = body as { quietHours?: unknown; entries?: unknown };

  if (quietHours === undefined || !Array.isArray(entries)) {
    throw invalid('quietHours (nullable) and entries are both required.', 'request.invalid', '');
  }

  let parsedQuietHours: UpdateNotificationPreferencesInput['quietHours'] = null;
  if (quietHours !== null) {
    if (typeof quietHours !== 'object' || Array.isArray(quietHours)) {
      throw invalid('quietHours must be an object or null.', 'request.invalid', '/quietHours');
    }
    const { startMinute, endMinute, timeZone } = quietHours as {
      startMinute?: unknown;
      endMinute?: unknown;
      timeZone?: unknown;
    };
    const start = requireMinute(startMinute, '/quietHours/startMinute');
    const end = requireMinute(endMinute, '/quietHours/endMinute');
    if (start === end) {
      throw invalid(
        'quietHours must not start and end at the same minute; disable the push channel instead.',
        'request.invalid',
        '/quietHours',
      );
    }
    if (timeZone !== null && timeZone !== undefined && typeof timeZone !== 'string') {
      throw invalid(
        'timeZone must be a string or null.',
        'request.invalid',
        '/quietHours/timeZone',
      );
    }
    if (typeof timeZone === 'string' && !isValidIanaTimeZone(timeZone)) {
      throw invalid(
        'timeZone must be a valid IANA time-zone identifier.',
        'request.invalid',
        '/quietHours/timeZone',
      );
    }
    parsedQuietHours = {
      startMinute: start,
      endMinute: end,
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    };
  }

  const parsedEntries = entries.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalid(
        'each entry must be an object.',
        'request.invalid',
        `/entries/${String(index)}`,
      );
    }
    const { notificationType, gardenId, inAppEnabled, pushEnabled } = entry as {
      notificationType?: unknown;
      gardenId?: unknown;
      inAppEnabled?: unknown;
      pushEnabled?: unknown;
    };
    if (typeof notificationType !== 'string' || notificationType === '') {
      throw invalid(
        'notificationType is required.',
        'request.invalid',
        `/entries/${String(index)}/notificationType`,
      );
    }
    if (gardenId !== null && (typeof gardenId !== 'string' || !UUID_PATTERN.test(gardenId))) {
      throw invalid(
        'gardenId must be a UUID or null.',
        'request.invalid',
        `/entries/${String(index)}/gardenId`,
      );
    }
    if (typeof inAppEnabled !== 'boolean' || typeof pushEnabled !== 'boolean') {
      throw invalid(
        'inAppEnabled and pushEnabled must be booleans.',
        'request.invalid',
        `/entries/${String(index)}`,
      );
    }
    return {
      notificationType,
      gardenId,
      inAppEnabled,
      pushEnabled,
    };
  });

  return { quietHours: parsedQuietHours, entries: parsedEntries };
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRoutesDependencies,
): void {
  app.get('/notifications', async (request, reply) => {
    const { cursor, limit } = parseInboxQuery(request);

    const outcome = await deps.listNotifications.execute(
      request.actorContext.profileId,
      cursor,
      limit,
    );

    // The read-triggered expiry close, made observable (notifications.md
    // section 15 measures intent lifecycle outcomes) — logged only when it
    // actually closed something, counts only.
    if (outcome.intentsExpired > 0) {
      request.log.info(
        { event: 'notifications.intents_expired', intentsExpired: outcome.intentsExpired },
        'Expired notification intents were closed by an inbox read',
      );
    }

    return reply.status(200).send(outcome.result);
  });

  app.post('/notifications/:notificationId/read', async (request, reply) => {
    const notificationId = requireNotificationId(request);

    const notification = await deps.markNotificationRead.execute(
      notificationId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(notification);
  });

  app.post('/notifications/:notificationId/dismiss', async (request, reply) => {
    const notificationId = requireNotificationId(request);

    const notification = await deps.dismissNotification.execute(
      notificationId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(notification);
  });

  app.get('/notification-preferences', async (request, reply) => {
    const preferences = await deps.getNotificationPreferences.execute(
      request.actorContext.profileId,
    );

    return reply.status(200).send(preferences);
  });

  app.put('/notification-preferences', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireDocumentRevision(request);
    const input = parsePreferencesBody(request.body);

    const preferences = await deps.updateNotificationPreferences.execute(
      request.actorContext.profileId,
      expectedRevision,
      input,
      idempotencyKey,
    );

    // "User preference changes" are a measured outcome (notifications.md
    // section 15) — counts and revision only, never the preference values.
    request.log.info(
      {
        event: 'notifications.preferences_updated',
        revision: preferences.revision,
        entryCount: preferences.entries.length,
        hasQuietHours: preferences.quietHours !== null,
      },
      'Notification preferences replaced',
    );

    return reply.status(200).send(preferences);
  });
}
