/**
 * Port to per-provider quota accounting over
 * `integrations.provider_quota_usage` — external-integrations.md section
 * 14's "Application-level quotas protect expensive integrations from abuse
 * or accidental loops", as an atomic consume-or-refuse operation.
 *
 * Semantics: one successful `consumeCall` counts one provider call against
 * BOTH the current UTC hour window and the current UTC day window,
 * atomically — either both counters advance and the call may proceed, or
 * neither advances and the result names the first exhausted window. A
 * `null` limit means unlimited for that window, but usage is still counted
 * (section 14 requires the "quota state" to be observable, not only
 * enforced). Consumption happens BEFORE the provider call, so concurrent
 * requests cannot collectively overshoot a budget; a consumed call that
 * then times out stays consumed — the call was made.
 *
 * The real adapter is `persistence/kysely-provider-quota-repository.ts`;
 * unit tests use `integrations-test-doubles.ts`'s in-memory fake.
 *
 * Source: architecture/external-integrations.md, section "14. Cost and
 * Quota"; migrations/1785700000000_integrations-weather-baseline.sql.
 */

import type { WeatherProviderQuotaLimits } from './weather-provider-registry.js';

export type ProviderQuotaWindowKind = 'hour' | 'day';

export type ProviderQuotaConsumeResult =
  | { readonly consumed: true }
  | { readonly consumed: false; readonly exhaustedWindow: ProviderQuotaWindowKind };

export interface ProviderQuotaRepository {
  consumeCall(
    providerKey: string,
    limits: WeatherProviderQuotaLimits,
    now: Date,
  ): Promise<ProviderQuotaConsumeResult>;
}

/** Start of the UTC window containing `now`. Exported for the Kysely adapter and the in-memory fake to share one definition. */
export function quotaWindowStart(kind: ProviderQuotaWindowKind, now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMinutes(0, 0, 0);
  if (kind === 'day') {
    start.setUTCHours(0);
  }
  return start;
}
