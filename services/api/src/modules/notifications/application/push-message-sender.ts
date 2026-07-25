/**
 * The FCM boundary (P7-NOTIF-02): the ONE live edge of the delivery path.
 *
 * Everything else — claiming, the send-time rechecks, invalid-token
 * handling, retry bookkeeping, attempt records — is deterministic
 * application logic tested against `FakePushMessageSender`; only the
 * adapter behind this port (`FcmPushMessageSender`, riding the same
 * `firebase-admin` app the token verifier already uses, per ADR-0002)
 * talks to Firebase Cloud Messaging.
 *
 * The port CLASSIFIES instead of throwing: notifications.md section 13's
 * failure taxonomy is exactly these four outcomes — provider acceptance
 * (not confirmed device display, section 15), a permanent token verdict
 * (the device channel is disabled idempotently), a transient failure
 * (retried within the intent's expiration under the bounded budget), and
 * a permanent non-token failure (the attempt is recorded failed without
 * poisoning the sweep). An adapter defect that cannot classify still
 * surfaces as `transient_failure` with the raw code — bounded retry makes
 * misclassification converge to `failed` instead of looping forever.
 */

import type { NotificationPriority } from '../domain/notification-intent.js';

export interface PushMessage {
  /** The device's FCM registration token — a secret; never logged. */
  readonly token: string;
  readonly priority: NotificationPriority;
  /** String-to-string data payload (`buildPushMessageData`) — identifiers only, never rendered text. */
  readonly data: Readonly<Record<string, string>>;
}

export type PushSendOutcome =
  | { readonly kind: 'accepted'; readonly providerMessageId: string }
  | { readonly kind: 'token_invalid'; readonly errorCode: string }
  | { readonly kind: 'transient_failure'; readonly errorCode: string }
  | { readonly kind: 'permanent_failure'; readonly errorCode: string };

export interface PushMessageSender {
  send(message: PushMessage): Promise<PushSendOutcome>;
}
