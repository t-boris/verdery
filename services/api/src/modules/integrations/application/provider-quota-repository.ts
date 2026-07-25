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

export type ProviderQuotaWindowKind = 'hour' | 'day';

/**
 * Per-provider call budgets. `null` means unlimited for that window; usage
 * is still counted either way (section 14's "quota state" telemetry).
 * Capability-neutral by design: `provider_quota_usage` counts calls per
 * provider key regardless of WHAT the provider serves, so the weather and
 * plant-content registries carry the same shape — the shared quota
 * machinery, owned by the port it budgets.
 */
export interface ProviderQuotaLimits {
  readonly maxCallsPerHour: number | null;
  readonly maxCallsPerDay: number | null;
}

export type ProviderQuotaConsumeResult =
  | { readonly consumed: true }
  | { readonly consumed: false; readonly exhaustedWindow: ProviderQuotaWindowKind };

export interface ProviderQuotaRepository {
  consumeCall(
    providerKey: string,
    limits: ProviderQuotaLimits,
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
