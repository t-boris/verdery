/**
 * Composition-root helper for the notifications module — split out of
 * `app.ts` for the same 600-line reason as its siblings. Still
 * composition-root code, not a module boundary.
 *
 * Wires four surfaces of one module:
 * - the user-facing inbox and preference routes (tag `Notifications`);
 * - the user-facing device-registration routes (P7-NOTIF-02, same tag) —
 *   register/refresh/remove a device's FCM channel;
 * - the internal machine-to-machine event endpoint the workers outbox
 *   relay posts notification-relevant `platform.outbox_event` rows to —
 *   the `domain event -> notification policy -> persist in-app intent`
 *   steps of notifications.md section 5;
 * - the internal delivery-sweep endpoint the workers interval scheduler
 *   triggers (P7-NOTIF-02) — the `preference and freshness recheck ->
 *   FCM delivery attempt` steps of the same flow.
 * All machine-to-machine endpoints are verified by the SAME worker-to-API
 * identity as every sweep and callback.
 */

import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import {
  ApplyNotificationPolicy,
  DismissNotification,
  GetNotificationPreferences,
  KyselyNotificationDeviceRepository,
  KyselyNotificationIntentRepository,
  KyselyNotificationPreferenceRepository,
  KyselyNotificationsUnitOfWork,
  ListNotifications,
  MarkNotificationRead,
  RegisterNotificationDevice,
  RemoveNotificationDevice,
  RunNotificationDeliverySweep,
  UpdateNotificationPreferences,
} from './modules/notifications/public.js';
import type {
  NotificationDeliverySweepRouteDependencies,
  NotificationDeviceRoutesDependencies,
  NotificationEventsRouteDependencies,
  NotificationRoutesDependencies,
  PushMessageSender,
} from './modules/notifications/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface NotificationsComposition {
  readonly notificationRoutesDependencies: NotificationRoutesDependencies;
  readonly notificationDeviceRoutesDependencies: NotificationDeviceRoutesDependencies;
  readonly notificationEventsRouteDependencies: NotificationEventsRouteDependencies;
  readonly notificationDeliverySweepRouteDependencies: NotificationDeliverySweepRouteDependencies;
}

export function composeNotifications(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
  pushMessageSender: PushMessageSender,
  /** Stamped onto every device registration — records are scoped to the environment that issued them (see `notification-device-commands.ts`). */
  environment: string,
): NotificationsComposition {
  const unitOfWork = new KyselyNotificationsUnitOfWork(database.queries, clock);
  // Pooled (non-transactional) adapters serve the single-statement reads
  // and the convergent inbox stamps, the way `taskRepository` serves the
  // task commands' pre-transaction reads.
  const intentRepository = new KyselyNotificationIntentRepository(database.queries);
  const preferenceRepository = new KyselyNotificationPreferenceRepository(database.queries);
  const deviceRepository = new KyselyNotificationDeviceRepository(database.queries);
  const idempotency = new KyselyIdempotencyStore(database.queries, clock);

  const notificationRoutesDependencies: NotificationRoutesDependencies = {
    listNotifications: new ListNotifications(unitOfWork, clock),
    markNotificationRead: new MarkNotificationRead(intentRepository, clock),
    dismissNotification: new DismissNotification(intentRepository, clock),
    getNotificationPreferences: new GetNotificationPreferences(preferenceRepository),
    updateNotificationPreferences: new UpdateNotificationPreferences(
      idempotency,
      unitOfWork,
      gardenAuthorization,
      clock,
    ),
  };

  const notificationDeviceRoutesDependencies: NotificationDeviceRoutesDependencies = {
    registerNotificationDevice: new RegisterNotificationDevice(unitOfWork, clock, environment),
    // Removal is a single-statement delete — the pooled adapter suffices.
    removeNotificationDevice: new RemoveNotificationDevice(deviceRepository),
  };

  const notificationEventsRouteDependencies: NotificationEventsRouteDependencies = {
    applyNotificationPolicy: new ApplyNotificationPolicy(unitOfWork, clock),
    cloudTasksInvocationVerifier,
  };

  const notificationDeliverySweepRouteDependencies: NotificationDeliverySweepRouteDependencies = {
    runNotificationDeliverySweep: new RunNotificationDeliverySweep(
      unitOfWork,
      pushMessageSender,
      clock,
    ),
    cloudTasksInvocationVerifier,
  };

  return {
    notificationRoutesDependencies,
    notificationDeviceRoutesDependencies,
    notificationEventsRouteDependencies,
    notificationDeliverySweepRouteDependencies,
  };
}
