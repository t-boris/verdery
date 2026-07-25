/**
 * The FCM adapter's request shaping and error classification
 * (P7-NOTIF-02), over a constructed `Messaging` stand-in — the live FCM
 * edge itself is unverifiable here (no real device token exists anywhere;
 * deferred-capabilities.md records that boundary), so these tests pin
 * exactly what the adapter DOES own: the message it builds and the
 * outcome taxonomy it returns.
 */

import type { Message, Messaging } from 'firebase-admin/messaging';
import { describe, expect, it } from 'vitest';
import { classifyFcmSendError, FcmPushMessageSender } from './fcm-push-message-sender.js';

function messagingStub(behavior: (message: Message) => Promise<string>): {
  messaging: Messaging;
  calls: Message[];
} {
  const calls: Message[] = [];
  const messaging = {
    send: (message: Message) => {
      calls.push(message);
      return behavior(message);
    },
  } as unknown as Messaging;
  return { messaging, calls };
}

function firebaseError(code: string): Error {
  const error = new Error(`stub: ${code}`);
  (error as Error & { code: string }).code = code;
  return error;
}

const MESSAGE = {
  token: 'a-device-token',
  priority: 'high' as const,
  data: { notificationId: 'n-1', templateKey: 'care_recommendation.created.v1' },
};

describe('FcmPushMessageSender', () => {
  it("sends a data-only message with both transports' priority knobs and returns the provider id", async () => {
    const { messaging, calls } = messagingStub(() => Promise.resolve('projects/x/messages/123'));
    const sender = new FcmPushMessageSender(messaging);

    const outcome = await sender.send(MESSAGE);

    expect(outcome).toEqual({ kind: 'accepted', providerMessageId: 'projects/x/messages/123' });
    expect(calls[0]).toEqual({
      token: 'a-device-token',
      data: { notificationId: 'n-1', templateKey: 'care_recommendation.created.v1' },
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { contentAvailable: true } },
      },
    });
  });

  it('maps normal priority to the low-power transport settings', async () => {
    const { messaging, calls } = messagingStub(() => Promise.resolve('id'));
    await new FcmPushMessageSender(messaging).send({ ...MESSAGE, priority: 'normal' });

    expect(calls[0]).toMatchObject({
      android: { priority: 'normal' },
      apns: { headers: { 'apns-priority': '5' } },
    });
  });

  it('classifies unregistered and invalid tokens as token_invalid — the device-disable trigger', async () => {
    for (const code of [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ]) {
      const { messaging } = messagingStub(() => Promise.reject(firebaseError(code)));
      const outcome = await new FcmPushMessageSender(messaging).send(MESSAGE);
      expect(outcome).toEqual({ kind: 'token_invalid', errorCode: code });
    }
  });

  it('classifies provider trouble and UNRECOGNIZED errors as transient — bounded retry converges either way', () => {
    for (const code of [
      'messaging/internal-error',
      'messaging/server-unavailable',
      'messaging/quota-exceeded',
    ]) {
      expect(classifyFcmSendError(firebaseError(code))).toEqual({
        kind: 'transient_failure',
        errorCode: code,
      });
    }
    // A codeless network failure never disables a device and never fails
    // the intent permanently on first sight.
    expect(classifyFcmSendError(new Error('socket hang up'))).toEqual({
      kind: 'transient_failure',
      errorCode: 'unknown',
    });
  });

  it('classifies other Firebase-coded errors as permanent — including invalid-argument, which may be OUR payload bug, never a dead device', () => {
    for (const code of [
      'messaging/invalid-argument',
      'messaging/payload-size-limit-exceeded',
      'messaging/mismatched-credential',
      'messaging/third-party-auth-error',
    ]) {
      expect(classifyFcmSendError(firebaseError(code))).toEqual({
        kind: 'permanent_failure',
        errorCode: code,
      });
    }
  });
});
