/**
 * Resend-backed `TransactionalEmailAdapter` (P9C-INVITE-01) — the
 * transactional-email decision implementation-plan.md section 29.1.1
 * records: "Resend (free tier, 3,000 messages/month, no subscription).
 * Named fallbacks: Postmark ... and Amazon SES ... neither implemented."
 *
 * VERIFIED LIVE, 2026-07-26 (`https://resend.com/docs/api-reference/emails/
 * send-email`), not assumed from memory:
 *
 * - `POST https://api.resend.com/emails`.
 * - Auth: `Authorization: Bearer <API key>` — a plain header, no signing, no
 *   SDK-specific request object.
 * - Body (JSON): `from` (string), `to` (string | string[]), `subject`
 *   required; `html`/`text` optional message content. This adapter always
 *   sends BOTH `html` and `text` — `TransactionalEmailMessage` requires both,
 *   so there is no "which one did the caller mean" ambiguity to resolve
 *   here.
 * - Success: `200` with `{ "id": "<uuid>" }` — the provider's own message
 *   id, mapped straight to `TransactionalEmailSendResult.providerMessageId`.
 *
 * PLAIN HTTPS/JSON, NO SDK. Resend publishes an official `resend` npm
 * package, but nothing about this one call needs it: a bearer header and a
 * JSON body is the entire contract, so this adapter calls the platform's own
 * `fetch` (Node 24, ADR-0009) exactly like `open-meteo-weather-adapter.ts`
 * does for the identical reason — no new dependency for one REST endpoint.
 *
 * FAILURE POSTURE, mirroring `OpenMeteoWeatherAdapter` exactly: a transport
 * error, a non-2xx status, or an unreadable/malformed body all reject with
 * `DependencyUnavailableError`. The response BODY is never included in the
 * thrown error or logged — unlike the weather adapter's URL (which carries
 * an API key), Resend's response body can carry the recipient's own email
 * address, which observability-and-analytics.md's prohibited-telemetry list
 * excludes with the same force a raw invitation token gets.
 *
 * WEBHOOK SIGNATURE VERIFICATION, VERIFIED BUT NOT BUILT HERE. Resend signs
 * delivery/bounce/complaint webhook events using Svix's convention (headers
 * `svix-id`/`svix-timestamp`/`svix-signature`; HMAC-SHA256 over
 * `{id}.{timestamp}.{rawBody}`, keyed by the base64 portion of a
 * `whsec_...`-prefixed secret, base64-encoded and compared against the
 * `v1,`-prefixed value(s) in `svix-signature`) — confirmed live against both
 * `resend.com/docs/dashboard/webhooks/verify-webhooks-requests` and Svix's
 * own manual-verification docs, and implementable with `node:crypto` alone
 * (`createHmac('sha256', ...)`), no SDK required, exactly like this file's
 * own sending half. NOT implemented in this package: nothing in
 * P9C-INVITE-01's own "what to build" list asks for a bounce/complaint
 * RECEIVER, no schema exists yet to record a delivery-status fact against an
 * invitation, and building one would be a genuinely separate capability
 * (suppression handling, delivery-status telemetry) rather than a detail of
 * SENDING the one invitation email this package's own commands need. Left as
 * a clearly-flagged, real follow-up rather than a silently-skipped
 * requirement — the identical "verified, scoped out, said so plainly"
 * posture this pass's own notification-intent wiring takes for
 * `client_update.published`.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "10. Transactional Messaging", "11. Reliability", "12.
 * Webhooks"; implementation-plan.md section 29.1.1.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  TransactionalEmailAdapter,
  TransactionalEmailMessage,
  TransactionalEmailSendResult,
} from '../application/transactional-email-provider.js';

export const RESEND_BASE_URL = 'https://api.resend.com';
export const RESEND_SEND_EMAIL_PATH = '/emails';

export interface ResendConfiguration {
  /** Treated as a secret and never logged (`SECRET_VARIABLES`). */
  readonly apiKey: string;
  /** The verified Resend sender address, e.g. `Verdery <invitations@mail.example.com>`. */
  readonly fromEmail: string;
}

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface ResendHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls — the identical `OpenMeteoHttpFetch` shape, injected for the same test-without-network reason. */
export type ResendHttpFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<ResendHttpResponse>;

function isResponseBodyWithId(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    return false;
  }
  return typeof value.id === 'string';
}

export class ResendTransactionalEmailAdapter implements TransactionalEmailAdapter {
  constructor(
    private readonly httpFetch: ResendHttpFetch,
    private readonly configuration: ResendConfiguration,
  ) {
    if (configuration.apiKey.trim().length === 0) {
      throw new Error('ResendTransactionalEmailAdapter requires a non-blank apiKey.');
    }
    if (configuration.fromEmail.trim().length === 0) {
      throw new Error('ResendTransactionalEmailAdapter requires a non-blank fromEmail.');
    }
  }

  async send(
    message: TransactionalEmailMessage,
    signal: AbortSignal,
  ): Promise<TransactionalEmailSendResult> {
    let response: ResendHttpResponse;
    try {
      response = await this.httpFetch(`${RESEND_BASE_URL}${RESEND_SEND_EMAIL_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.configuration.fromEmail,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal,
      });
    } catch (error) {
      // Includes the caller's own abort: the deadline already decided the
      // outcome, and this rejection is what tells it the call really stopped.
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'The transactional email provider did not complete the request.',
        { cause: error },
      );
    }

    if (!response.ok) {
      // The status alone — never the response body, which can carry the
      // recipient's own email address. See this file's own header.
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        `The transactional email provider answered with HTTP status ${String(response.status)}.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'The transactional email provider response body was not readable JSON.',
        { cause: error },
      );
    }

    if (!isResponseBodyWithId(body)) {
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'The transactional email provider response did not include a message id.',
      );
    }

    return { providerMessageId: body.id };
  }
}
