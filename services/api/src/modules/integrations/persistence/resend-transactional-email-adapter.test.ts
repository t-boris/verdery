/**
 * Unit tests for the Resend transactional-email adapter — request shaping
 * (method, URL, bearer auth, JSON body), success mapping, and failure
 * classification, all against the VERIFIED shape
 * (`resend-transactional-email-adapter.ts`'s own header names how it was
 * confirmed). No test here touches the network: `fetch` is injected, the
 * same posture `open-meteo-weather-adapter.test.ts` already establishes.
 */

import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { TransactionalEmailMessage } from '../application/transactional-email-provider.js';
import {
  RESEND_BASE_URL,
  RESEND_SEND_EMAIL_PATH,
  ResendTransactionalEmailAdapter,
} from './resend-transactional-email-adapter.js';
import type {
  ResendConfiguration,
  ResendHttpFetch,
  ResendHttpResponse,
} from './resend-transactional-email-adapter.js';

const CONFIGURATION: ResendConfiguration = {
  apiKey: 're_test_secret_key',
  fromEmail: 'Verdery <invitations@mail.verdery-test.example>',
};

const MESSAGE: TransactionalEmailMessage = {
  to: 'client@example.test',
  subject: 'You have been invited',
  html: '<p>Open your invitation</p>',
  text: 'Open your invitation',
};

type FetchCall = { readonly url: string; readonly init: Parameters<ResendHttpFetch>[1] };

type FetchBehavior =
  | { readonly kind: 'json'; readonly status?: number; readonly body: unknown }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'unreadableBody' }
  | { readonly kind: 'reject'; readonly error: Error };

function recordingFetch(behavior: FetchBehavior): { fetch: ResendHttpFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];

  const fetch: ResendHttpFetch = (url, init) => {
    calls.push({ url, init });

    switch (behavior.kind) {
      case 'json': {
        const response: ResendHttpResponse = {
          ok: (behavior.status ?? 200) < 300,
          status: behavior.status ?? 200,
          json: () => Promise.resolve(behavior.body),
        };
        return Promise.resolve(response);
      }
      case 'status': {
        const response: ResendHttpResponse = {
          ok: false,
          status: behavior.status,
          json: () => Promise.resolve({}),
        };
        return Promise.resolve(response);
      }
      case 'unreadableBody': {
        const response: ResendHttpResponse = {
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error('unexpected end of JSON input')),
        };
        return Promise.resolve(response);
      }
      case 'reject':
        return Promise.reject(behavior.error);
    }
  };

  return { fetch, calls };
}

function adapterOver(behavior: FetchBehavior, configuration: ResendConfiguration = CONFIGURATION) {
  const { fetch, calls } = recordingFetch(behavior);
  return { adapter: new ResendTransactionalEmailAdapter(fetch, configuration), calls };
}

describe('ResendTransactionalEmailAdapter construction', () => {
  it('refuses a blank API key or a blank sender at construction, before any request', () => {
    expect(
      () =>
        new ResendTransactionalEmailAdapter(recordingFetch({ kind: 'json', body: {} }).fetch, {
          ...CONFIGURATION,
          apiKey: '   ',
        }),
    ).toThrow(/apiKey/);
    expect(
      () =>
        new ResendTransactionalEmailAdapter(recordingFetch({ kind: 'json', body: {} }).fetch, {
          ...CONFIGURATION,
          fromEmail: '',
        }),
    ).toThrow(/fromEmail/);
  });
});

describe('ResendTransactionalEmailAdapter request shape', () => {
  const signal = new AbortController().signal;

  it('POSTs to the verified endpoint with a bearer header and the exact JSON body', async () => {
    const { adapter, calls } = adapterOver({ kind: 'json', body: { id: 'msg_123' } });

    await adapter.send(MESSAGE, signal);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${RESEND_BASE_URL}${RESEND_SEND_EMAIL_PATH}`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers['Authorization']).toBe(`Bearer ${CONFIGURATION.apiKey}`);
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({
      from: CONFIGURATION.fromEmail,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
    expect(calls[0]?.init.signal).toBe(signal);
  });

  it('maps a successful response to the provider message id', async () => {
    const { adapter } = adapterOver({ kind: 'json', body: { id: 'msg_abc123' } });

    await expect(adapter.send(MESSAGE, signal)).resolves.toEqual({
      providerMessageId: 'msg_abc123',
    });
  });
});

describe('ResendTransactionalEmailAdapter failure handling', () => {
  const signal = new AbortController().signal;

  it('rejects a non-2xx status without echoing the response body, which may carry the recipient address', async () => {
    const { adapter } = adapterOver({ kind: 'status', status: 429 });

    const error = await adapter.send(MESSAGE, signal).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DependencyUnavailableError);
    expect((error as Error).message).not.toContain(MESSAGE.to);
    expect((error as Error).message).toContain('429');
  });

  it('rejects an unreadable body', async () => {
    const { adapter } = adapterOver({ kind: 'unreadableBody' });

    await expect(adapter.send(MESSAGE, signal)).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('rejects a transport failure, including the caller’s own abort', async () => {
    const { adapter } = adapterOver({ kind: 'reject', error: new Error('ECONNRESET') });

    await expect(adapter.send(MESSAGE, signal)).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('rejects a malformed success body with no message id', async () => {
    const { adapter } = adapterOver({ kind: 'json', body: { ok: true } });

    await expect(adapter.send(MESSAGE, signal)).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
