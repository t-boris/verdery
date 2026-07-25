/**
 * Read-model mapping for the Notifications contract surface (P7-NOTIF-01):
 * purpose-built resources matching `openapi.yaml`'s `Notification` and
 * `NotificationPreferencesDocument` schemas, never persistence rows.
 */

import type { NotificationIntent } from '../domain/notification-intent.js';
import type {
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from '../domain/notification-preference.js';

export interface NotificationDeepLinkResource {
  readonly kind: 'gardenToday';
  readonly gardenId: string;
  readonly recommendationCandidateId: string;
}

export interface NotificationResource {
  readonly id: string;
  readonly notificationType: string;
  readonly priority: 'normal' | 'high';
  readonly gardenId: string;
  readonly recommendationCandidateId: string | null;
  readonly templateKey: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly deepLink: NotificationDeepLinkResource;
  readonly readAt: string | null;
  readonly dismissedAt: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface NotificationListResource {
  readonly items: readonly NotificationResource[];
  readonly nextCursor?: string;
}

export interface NotificationQuietHoursResource {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeZone: string | null;
}

export interface NotificationPreferenceEntryResource {
  readonly notificationType: string;
  readonly gardenId: string | null;
  readonly inAppEnabled: boolean;
  readonly pushEnabled: boolean;
}

export interface NotificationPreferencesResource {
  readonly revision: number;
  readonly quietHours: NotificationQuietHoursResource | null;
  readonly entries: readonly NotificationPreferenceEntryResource[];
}

export function toNotificationResource(intent: NotificationIntent): NotificationResource {
  return {
    id: intent.id,
    notificationType: intent.intentType,
    priority: intent.priority,
    gardenId: intent.gardenId,
    recommendationCandidateId: intent.recommendationCandidateId,
    templateKey: intent.templateKey,
    parameters: intent.templateParameters,
    deepLink: {
      kind: intent.deepLink.kind,
      gardenId: intent.deepLink.gardenId,
      recommendationCandidateId: intent.deepLink.recommendationCandidateId,
    },
    readAt: intent.readAt === null ? null : intent.readAt.toISOString(),
    dismissedAt: intent.dismissedAt === null ? null : intent.dismissedAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    createdAt: intent.createdAt.toISOString(),
  };
}

export function toPreferencesResource(
  settings: NotificationPreferenceSettings,
  entries: readonly NotificationPreferenceEntry[],
): NotificationPreferencesResource {
  return {
    revision: settings.revision,
    quietHours:
      settings.quietHours === null
        ? null
        : {
            startMinute: settings.quietHours.startMinute,
            endMinute: settings.quietHours.endMinute,
            timeZone: settings.quietHoursTimeZone,
          },
    entries: entries.map((entry) => ({
      notificationType: entry.notificationType,
      gardenId: entry.gardenId,
      inAppEnabled: entry.inAppEnabled,
      pushEnabled: entry.pushEnabled,
    })),
  };
}
