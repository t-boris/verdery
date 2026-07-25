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
export {
  INBOX_VISIBLE_STATES,
  isInboxVisible,
  validateIntentStateTransition,
} from './domain/notification-intent.js';
export type {
  NotificationDevice,
  NotificationDevicePlatform,
  NotificationDeviceStatus,
} from './domain/notification-device.js';
export {
  DEVICE_DISABLED_REASON_TOKEN_INVALID,
  isNotificationDevicePlatform,
} from './domain/notification-device.js';
export type {
  SendTimeDecision,
  SendTimeFacts,
  SendTimeSkipReason,
} from './domain/notification-delivery.js';
export {
  buildPushMessageData,
  decideSendTimeAction,
  MAX_DELIVERY_ATTEMPTS,
  resolveTransientRetryAt,
} from './domain/notification-delivery.js';
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
  EventSuppressionReason,
  RecipientPolicyDecision,
  RecipientPolicyInput,
  RecipientSuppressionReason,
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
export {
  RegisterNotificationDevice,
  RemoveNotificationDevice,
} from './application/notification-device-commands.js';
export type { NotificationDeviceResource } from './application/notification-device-commands.js';
export { RunNotificationDeliverySweep } from './application/run-notification-delivery-sweep.js';
export type {
  DeliveryFailReason,
  NotificationDeliverySweepResult,
} from './application/run-notification-delivery-sweep.js';
export type {
  PushMessage,
  PushMessageSender,
  PushSendOutcome,
} from './application/push-message-sender.js';
export type { NotificationsUnitOfWork } from './application/notifications-unit-of-work.js';
export type { NotificationIntentRepository } from './application/notification-intent-repository.js';
export type { NotificationPreferenceRepository } from './application/notification-preference-repository.js';
export type { NotificationDeviceRepository } from './application/notification-device-repository.js';
export type { NotificationDeliveryRepository } from './application/notification-delivery-repository.js';
export { KyselyNotificationIntentRepository } from './persistence/kysely-notification-intent-repository.js';
export { KyselyNotificationPreferenceRepository } from './persistence/kysely-notification-preference-repository.js';
export { KyselyNotificationDeviceRepository } from './persistence/kysely-notification-device-repository.js';
export { KyselyNotificationsUnitOfWork } from './persistence/kysely-notifications-unit-of-work.js';
export { FcmPushMessageSender } from './persistence/fcm-push-message-sender.js';
export type { NotificationsDatabaseSchema } from './persistence/schema.js';
export { registerNotificationRoutes } from './transport/notification-routes.js';
export type { NotificationRoutesDependencies } from './transport/notification-routes.js';
export { registerNotificationDeviceRoutes } from './transport/notification-device-routes.js';
export type { NotificationDeviceRoutesDependencies } from './transport/notification-device-routes.js';
export { registerNotificationEventsRoute } from './transport/notification-events-route.js';
export type { NotificationEventsRouteDependencies } from './transport/notification-events-route.js';
export { registerNotificationDeliverySweepRoute } from './transport/notification-delivery-sweep-route.js';
export type { NotificationDeliverySweepRouteDependencies } from './transport/notification-delivery-sweep-route.js';
