/**
 * Device-registration HTTP routes (P7-NOTIF-02) — the `Notifications`
 * tag's `PUT`/`DELETE /notification-devices/{deviceInstallationId}`:
 * register-or-refresh and remove a device's FCM channel. Hand-validated
 * against the OpenAPI document like every sibling transport.
 *
 * Both operations are idempotent BY DESIGN and take neither
 * `Idempotency-Key` nor `If-Match` — see the contract operations and
 * `notification-device-commands.ts`' header for the reasoning. Both are
 * scoped to the AUTHENTICATED caller: no path names another profile.
 *
 * The token is a secret: it is parsed, length-bounded, handed to the use
 * case, and NEVER logged — the registration log line below carries the
 * installation id and platform only.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { invalid, UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import { isNotificationDevicePlatform } from '../domain/notification-device.js';
import type {
  RegisterNotificationDevice,
  RegisterNotificationDeviceInput,
  RemoveNotificationDevice,
} from '../application/notification-device-commands.js';

export interface NotificationDeviceRoutesDependencies {
  readonly registerNotificationDevice: RegisterNotificationDevice;
  readonly removeNotificationDevice: RemoveNotificationDevice;
}

/** The contract's own bound: FCM registration tokens run a few hundred characters; 4096 rejects garbage without ever clipping a real token. */
const FCM_TOKEN_MAX_LENGTH = 4096;

function requireInstallationId(request: FastifyRequest): string {
  const { deviceInstallationId } = request.params as { deviceInstallationId?: unknown };

  if (typeof deviceInstallationId !== 'string' || !UUID_PATTERN.test(deviceInstallationId)) {
    throw invalid(
      'deviceInstallationId must be a UUID.',
      'request.device_installation_id.invalid',
      '/deviceInstallationId',
    );
  }

  return deviceInstallationId;
}

function parseRegistrationBody(body: unknown): RegisterNotificationDeviceInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('the request body must be an object.', 'request.invalid', '');
  }
  const { platform, fcmToken } = body as { platform?: unknown; fcmToken?: unknown };

  if (typeof platform !== 'string' || !isNotificationDevicePlatform(platform)) {
    throw invalid('platform must be "ios" or "web".', 'request.invalid', '/platform');
  }
  if (
    typeof fcmToken !== 'string' ||
    fcmToken.length === 0 ||
    fcmToken.length > FCM_TOKEN_MAX_LENGTH
  ) {
    throw invalid(
      `fcmToken must be a non-empty string of at most ${String(FCM_TOKEN_MAX_LENGTH)} characters.`,
      'request.invalid',
      '/fcmToken',
    );
  }

  return { platform, fcmToken };
}

export function registerNotificationDeviceRoutes(
  app: FastifyInstance,
  deps: NotificationDeviceRoutesDependencies,
): void {
  app.put('/notification-devices/:deviceInstallationId', async (request, reply) => {
    const installationId = requireInstallationId(request);
    const input = parseRegistrationBody(request.body);

    const device = await deps.registerNotificationDevice.execute(
      request.actorContext.profileId,
      installationId,
      input,
    );

    // A measured outcome (notifications.md section 15 counts device
    // registrations into channel health) — identifiers and platform only,
    // NEVER the token.
    request.log.info(
      {
        event: 'notifications.device_registered',
        installationId,
        platform: device.platform,
      },
      'Notification device registered or refreshed',
    );

    return reply.status(200).send(device);
  });

  app.delete('/notification-devices/:deviceInstallationId', async (request, reply) => {
    const installationId = requireInstallationId(request);

    await deps.removeNotificationDevice.execute(request.actorContext.profileId, installationId);

    request.log.info(
      { event: 'notifications.device_removed', installationId },
      'Notification device removed',
    );

    return reply.status(204).send();
  });
}
