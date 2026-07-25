/**
 * Public interface of the notifications module (P7-NOTIF-01).
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type {
  GardenTodayDeepLink,
  NotificationDeepLink,
  NotificationIntent,
  NotificationIntentState,
  NotificationPriority,
} from './domain/notification-intent.js';
export { isInboxVisible, validateIntentStateTransition } from './domain/notification-intent.js';
export type {
  ChannelPreference,
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from './domain/notification-preference.js';
export {
  CARE_RECOMMENDATION_INTENT_TYPE,
  DEFAULT_CHANNEL_PREFERENCE,
  isKnownNotificationType,
  KNOWN_NOTIFICATION_TYPES,
  resolveChannelPreference,
} from './domain/notification-preference.js';
export type { QuietHours } from './domain/quiet-hours.js';
export {
  isValidIanaTimeZone,
  isWithinQuietHours,
  resolveEarliestDeliveryAt,
  validateQuietHours,
} from './domain/quiet-hours.js';
export type {
  CandidateFreshnessFacts,
  RecipientPolicyDecision,
  RecipientPolicyInput,
} from './domain/notification-policy.js';
export {
  assessCareRecommendationEvent,
  evaluateRecipientPolicy,
} from './domain/notification-policy.js';
export { ApplyNotificationPolicy } from './application/apply-notification-policy.js';
export { ListNotifications } from './application/list-notifications.js';
export {
  DismissNotification,
  MarkNotificationRead,
} from './application/notification-inbox-commands.js';
export {
  GetNotificationPreferences,
  UpdateNotificationPreferences,
} from './application/notification-preference-commands.js';
export type { NotificationsUnitOfWork } from './application/notifications-unit-of-work.js';
export type { NotificationIntentRepository } from './application/notification-intent-repository.js';
export type { NotificationPreferenceRepository } from './application/notification-preference-repository.js';
export { KyselyNotificationIntentRepository } from './persistence/kysely-notification-intent-repository.js';
export { KyselyNotificationPreferenceRepository } from './persistence/kysely-notification-preference-repository.js';
export { KyselyNotificationsUnitOfWork } from './persistence/kysely-notifications-unit-of-work.js';
export type { NotificationsDatabaseSchema } from './persistence/schema.js';
export { registerNotificationRoutes } from './transport/notification-routes.js';
export type { NotificationRoutesDependencies } from './transport/notification-routes.js';
export { registerNotificationEventsRoute } from './transport/notification-events-route.js';
export type { NotificationEventsRouteDependencies } from './transport/notification-events-route.js';
