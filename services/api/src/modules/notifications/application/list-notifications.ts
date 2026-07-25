/**
 * The inbox query (P7-NOTIF-01): one page of the caller's live
 * notification entries, newest first — notifications.md section 12's
 * durable user-facing record, correct whether or not any push was ever
 * attempted (the phase exit criterion "In-app intent remains correct even
 * when push delivery fails").
 *
 * EXPIRY DECISION — the QUERY closes the caller's own past-expiry pending
 * intents (`pending -> expired`, revision-bumped) in the same transaction
 * that reads the page, the `GetTodayView` read-triggers-write precedent
 * with the same justification shape: (1) expiration is a server-observable
 * fact the read is already dated by; (2) a filter-only read would leave
 * `expired` a state nothing reaches until P7-NOTIF-02's delivery worker
 * exists — dead vocabulary; (3) the write is naturally idempotent (an
 * expired row leaves the `pending` condition) and bounded to the caller's
 * own rows, so the GET stays safely retryable. The delivery worker later
 * closes expired intents at send time too, for recipients who never open
 * their inbox.
 *
 * Cursor pagination (not a capped selection like Today): the inbox is a
 * browsable history the user scrolls, exactly `ListGardens`' shape —
 * opaque base64url keyset cursor over the UUIDv7 id ordering.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { NotificationListResource } from './notification-view.js';
import { toNotificationResource } from './notification-view.js';
import type { NotificationsUnitOfWork } from './notifications-unit-of-work.js';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface InboxCursor {
  readonly beforeId: Uuid;
}

function invalidCursor(): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, 'The cursor is invalid.', {
    details: [{ code: 'request.cursor.invalid', pointer: '/cursor' }],
  });
}

function decodeCursor(cursor: string): InboxCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { beforeId?: unknown }).beforeId !== 'string' ||
      !UUID_SHAPE.test((parsed as { beforeId: string }).beforeId)
    ) {
      throw invalidCursor();
    }
    return parsed as InboxCursor;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw invalidCursor();
  }
}

function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Named export so the transport and tests share the summary's log-field identity. */
export interface InboxPageOutcome {
  readonly result: NotificationListResource;
  /** How many of the caller's intents this read durably closed as expired. */
  readonly intentsExpired: number;
}

export class ListNotifications {
  constructor(
    private readonly unitOfWork: NotificationsUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(profileId: Uuid, cursor: string | null, limit: number): Promise<InboxPageOutcome> {
    const beforeId = cursor === null ? null : decodeCursor(cursor).beforeId;
    const now = this.clock.now();

    return this.unitOfWork.run(async (context) => {
      const intentsExpired = await context.intents.expirePendingForRecipient(profileId, now);

      // One extra row decides `nextCursor` without a count query — the
      // established list-pagination mechanic.
      const rows = await context.intents.listInboxPage(profileId, beforeId, limit + 1);
      const page = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const lastRow = page[page.length - 1];

      return {
        result: {
          items: page.map(toNotificationResource),
          ...(hasMore && lastRow !== undefined
            ? { nextCursor: encodeCursor({ beforeId: lastRow.id }) }
            : {}),
        },
        intentsExpired,
      };
    });
  }
}
