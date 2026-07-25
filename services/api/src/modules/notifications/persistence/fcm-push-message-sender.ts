/**
 * The real FCM adapter behind `PushMessageSender` (P7-NOTIF-02) — the one
 * live edge of the delivery path, riding the SAME `firebase-admin` app the
 * token and App Check verifiers already use (ADR-0002: FCM messaging is
 * the Admin SDK's own messaging surface, no new dependency class).
 *
 * CLASSIFICATION over exceptions — the port's contract:
 * - `token_invalid`: the provider says this registration token is dead
 *   (`messaging/registration-token-not-registered`,
 *   `messaging/invalid-registration-token`) — the caller disables the
 *   device channel idempotently (notifications.md section 6).
 *   `messaging/invalid-argument` is deliberately NOT here: it also covers
 *   a malformed payload, and a payload defect of ours must never execute
 *   a device record.
 * - `transient_failure`: provider-side trouble worth a bounded retry
 *   (`internal-error`, `server-unavailable`, `quota-exceeded`), plus any
 *   UNRECOGNIZED error (network failures, new SDK codes) — the bounded
 *   retry budget converges misclassification to `failed` instead of
 *   looping, and the honest alternative (permanent) would drop deliveries
 *   on every transient shape this list does not yet name.
 * - `permanent_failure`: every other Firebase-coded error (mismatched
 *   credential, payload too large, third-party auth) — retrying cannot
 *   help, the attempt is recorded failed.
 *
 * The message is DATA-ONLY (`buildPushMessageData`'s identifiers): the
 * client renders locale-late (section 8) and lock screens never see
 * garden details. Priority maps to both transports' native knobs; the
 * APNs `content-available` flag is what lets a data-only message wake the
 * iOS app for local presentation — the client-side half is deferred
 * client work (deferred-capabilities.md).
 *
 * Tokens are secrets: nothing here logs the message or the token; errors
 * carry provider codes only.
 */

import type { Messaging } from 'firebase-admin/messaging';
import type {
  PushMessage,
  PushMessageSender,
  PushSendOutcome,
} from '../application/push-message-sender.js';

const TOKEN_INVALID_CODES: readonly string[] = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];

const TRANSIENT_CODES: readonly string[] = [
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/quota-exceeded',
];

/** The Admin SDK's `FirebaseError` shape, narrowed structurally — no dependency on its internal class hierarchy. */
function firebaseErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

export function classifyFcmSendError(
  error: unknown,
): Exclude<PushSendOutcome, { kind: 'accepted' }> {
  const code = firebaseErrorCode(error);

  if (code !== null && TOKEN_INVALID_CODES.includes(code)) {
    return { kind: 'token_invalid', errorCode: code };
  }
  if (code === null || TRANSIENT_CODES.includes(code)) {
    return { kind: 'transient_failure', errorCode: code ?? 'unknown' };
  }
  return { kind: 'permanent_failure', errorCode: code };
}

export class FcmPushMessageSender implements PushMessageSender {
  constructor(private readonly messaging: Messaging) {}

  async send(message: PushMessage): Promise<PushSendOutcome> {
    try {
      const providerMessageId = await this.messaging.send({
        token: message.token,
        data: { ...message.data },
        android: { priority: message.priority === 'high' ? 'high' : 'normal' },
        apns: {
          headers: { 'apns-priority': message.priority === 'high' ? '10' : '5' },
          payload: { aps: { contentAvailable: true } },
        },
      });
      return { kind: 'accepted', providerMessageId };
    } catch (error) {
      return classifyFcmSendError(error);
    }
  }
}
