/**
 * Provider-neutral transactional-email port (P9C-INVITE-01) — the identical
 * boundary `weather-provider.ts` documents at length for its own capability:
 * "domain/application → provider-neutral port → provider adapter → external
 * API. Provider SDK and payload types remain inside the adapter." Selected
 * ahead of the weather half of `P0-PROV-01` (Resend, decided 2026-07-26 —
 * implementation-plan.md section 29.1.1, "one adapter class plus one
 * registration, matching the weather integration's own pattern").
 *
 * DELIBERATELY GENERIC, NOT "SEND A CLIENT INVITATION". The port itself owns
 * no opinion about WHO an email is for or WHAT it says — external-
 * integrations.md section 10's own sentence, "The application owns
 * notification intent and preference logic; the provider owns only delivery
 * transport," reads the same way for the PORT as for the adapter: composing
 * a client-invitation email's subject/body is `collaboration/application/
 * client-invitation-email-content.ts`'s job, a caller of this port, not a
 * concern this interface encodes. A later transactional-email use (a
 * publication notice, a support reply) reuses the same `send`, never a
 * second port.
 *
 * NO REGISTRY, UNLIKE `WeatherProviderRegistry`. That registry exists because
 * weather has TWO real consumers (`RefreshGardenWeather`'s sweep path and the
 * AI-explanation embellishment) that both need "which adapter is active"
 * resolved once, decoupled from either call site. Transactional email has
 * exactly one consumer today (`CreateClientInvitation`), the same "only one
 * caller, nothing to decouple yet" reasoning `GenerateAiExplanation` already
 * gives for taking its adapter as a plain nullable constructor dependency
 * rather than a registry lookup — mirrored here for the identical reason,
 * not because the pattern was skipped.
 */

export interface TransactionalEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface TransactionalEmailSendResult {
  /** The provider's own message identifier — logged for support/audit correlation, never the message body or recipient. */
  readonly providerMessageId: string;
}

export interface TransactionalEmailAdapter {
  /**
   * Sends one transactional email. `signal` aborts when the caller's bounded
   * deadline (external-integrations.md section 11) expires — a real HTTP
   * adapter must pass it through to its request. May reject with anything;
   * the caller converts every failure into a typed degradation, the
   * identical `WeatherProviderAdapter.fetchWeather` contract.
   */
  send(
    message: TransactionalEmailMessage,
    signal: AbortSignal,
  ): Promise<TransactionalEmailSendResult>;
}
