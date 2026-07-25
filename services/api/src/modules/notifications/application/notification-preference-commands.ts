/**
 * The preference read and the whole-document replacement (P7-NOTIF-01) —
 * notifications.md section 7's preference surface.
 *
 * AUTHORIZATION: "Notification preferences are application-authorized"
 * (section 14) — the document is the CALLER's own (scoped by the
 * authenticated profile; no path parameter can name someone else's), and
 * each garden-scoped entry additionally requires current ACTIVE membership
 * on that garden, concealed as not-found otherwise — a caller must not be
 * able to probe garden ids through preference writes.
 *
 * CONCURRENCY: the PUT replaces the whole document under the document
 * revision (`If-Match`), with revision `0` meaning "never written" — the
 * one revision-guarded resource whose expected revision may legitimately
 * be zero, because the document is created lazily by its first write
 * rather than provisioned per profile. A concurrent first write loses as a
 * clean stale-revision conflict (the store's `ON CONFLICT DO NOTHING`
 * insert), never as an aborted transaction.
 */

import { NotificationErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import { StaleRevisionError, ValidationError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { NotificationPreferenceEntry } from '../domain/notification-preference.js';
import { isKnownNotificationType } from '../domain/notification-preference.js';
import type { QuietHours } from '../domain/quiet-hours.js';
import { isValidIanaTimeZone, validateQuietHours } from '../domain/quiet-hours.js';
import type { NotificationPreferenceRepository } from './notification-preference-repository.js';
import type { NotificationPreferencesResource } from './notification-view.js';
import { toPreferencesResource } from './notification-view.js';
import type { NotificationsUnitOfWork } from './notifications-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

export class GetNotificationPreferences {
  constructor(private readonly preferences: NotificationPreferenceRepository) {}

  async execute(profileId: Uuid): Promise<NotificationPreferencesResource> {
    const [settings, entries] = await Promise.all([
      this.preferences.getSettings(profileId),
      this.preferences.listEntries(profileId),
    ]);
    return toPreferencesResource(settings, entries);
  }
}

/** The already-shape-validated request the transport hands over. */
export interface UpdateNotificationPreferencesInput {
  readonly quietHours: (QuietHours & { readonly timeZone: string | null }) | null;
  readonly entries: readonly NotificationPreferenceEntry[];
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export class UpdateNotificationPreferences {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: NotificationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    profileId: Uuid,
    expectedRevision: number,
    input: UpdateNotificationPreferencesInput,
    idempotencyKey: string,
  ): Promise<NotificationPreferencesResource> {
    this.validate(input);

    // Membership on every garden a scoped entry names, checked before the
    // transaction like every command's authorization read; `viewGarden`
    // because tuning one's own notifications about a garden is a fact of
    // membership itself, not a content edit.
    const gardenIds = [
      ...new Set(
        input.entries
          .map((entry) => entry.gardenId)
          .filter((gardenId): gardenId is Uuid => gardenId !== null),
      ),
    ];
    for (const gardenId of gardenIds) {
      await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');
    }

    const now = this.clock.now();

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      {
        actorProfileId: profileId,
        operation: 'notifications.preferences.update',
        idempotencyKey,
        requestFingerprint: JSON.stringify({ expectedRevision, input }),
      },
      200,
      async (context) => {
        const revision = await context.preferences.replaceDocument(
          profileId,
          expectedRevision,
          {
            quietHours:
              input.quietHours === null
                ? null
                : {
                    startMinute: input.quietHours.startMinute,
                    endMinute: input.quietHours.endMinute,
                  },
            quietHoursTimeZone: input.quietHours?.timeZone ?? null,
            entries: input.entries,
          },
          now,
        );

        if (revision === null) {
          throw new StaleRevisionError(
            NotificationErrorCode.PreferencesStaleRevision,
            'The notification preference document was changed by another request.',
          );
        }

        return toPreferencesResource(
          {
            quietHours:
              input.quietHours === null
                ? null
                : {
                    startMinute: input.quietHours.startMinute,
                    endMinute: input.quietHours.endMinute,
                  },
            quietHoursTimeZone: input.quietHours?.timeZone ?? null,
            revision,
          },
          input.entries,
        );
      },
    );
  }

  private validate(input: UpdateNotificationPreferencesInput): void {
    if (input.quietHours !== null) {
      // Contract bounds already reject out-of-range minutes at transport;
      // the domain validation runs again here so the invariant does not
      // depend on transport parsing alone.
      validateQuietHours(input.quietHours);
      if (input.quietHours.timeZone !== null && !isValidIanaTimeZone(input.quietHours.timeZone)) {
        throw invalid(
          'quietHours.timeZone must be a valid IANA time-zone identifier.',
          'notification.preferences.time_zone_invalid',
          '/quietHours/timeZone',
        );
      }
    }

    const seen = new Set<string>();
    for (const [index, entry] of input.entries.entries()) {
      if (!isKnownNotificationType(entry.notificationType)) {
        throw invalid(
          `"${entry.notificationType}" is not a known notification type.`,
          'notification.preferences.type_unknown',
          `/entries/${String(index)}/notificationType`,
        );
      }
      const scope = `${entry.notificationType}:${entry.gardenId ?? 'global'}`;
      if (seen.has(scope)) {
        throw invalid(
          'entries must not repeat a type/garden combination.',
          'notification.preferences.entry_duplicated',
          `/entries/${String(index)}`,
        );
      }
      seen.add(scope);
    }
  }
}
