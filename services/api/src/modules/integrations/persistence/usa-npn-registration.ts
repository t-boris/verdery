/**
 * The USA-NPN registry entry — the `PlantAssertionProviderMetadata` the
 * registry validates and `refresh-taxon-assertions.ts` snapshots onto every
 * fact assertion it writes as `sourceCitation`.
 *
 * THE TERMS, per `docs/development/plant-knowledge-provider-runbooks.md`
 * section 3.2: the Terms of Use require attribution/citation with a source
 * URL — `attributionText` is non-null, unlike USDA PLANTS' `null`. The two
 * linked detail policies (Data Use Policy, Data Attribution Policy) were
 * NOT independently reachable during that research session — the runbook
 * itself flags this citation text as needing reconfirmation against those
 * policies before this adapter is enabled outside development. That flag is
 * repeated here, not resolved: the citation text below is a reasonable,
 * conservative attribution (project name + URL), not a copy of USA-NPN's
 * own exact required wording, which remains unverified.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { ProviderQuotaLimits } from '../application/provider-quota-repository.js';
import type { PlantAssertionProviderRegistration } from '../application/plant-assertion-provider-registry.js';
import type { UsaNpnHttpFetch } from './usa-npn-adapter.js';
import { UsaNpnAdapter } from './usa-npn-adapter.js';

/** Application-owned stable key — stamped as `provider_key` on every assertion this adapter produces. */
export const USA_NPN_PROVIDER_KEY = 'usa-npn';

export const USA_NPN_DISPLAY_NAME = 'USA National Phenology Network';

/** Conservative attribution — reconfirm against USA-NPN's own Data Attribution Policy before enabling outside development; see this file's own header. */
export const USA_NPN_CITATION =
  'USA National Phenology Network, National Coordinating Office. https://www.usanpn.org.';

const LICENSE_NOTE =
  'Terms of Use require attribution/citation with a source URL (docs/development/plant-knowledge-' +
  'provider-runbooks.md section 3.2). The exact required wording was not independently confirmed ' +
  `during that research — reconfirm before enabling outside development. Working citation: ${USA_NPN_CITATION} ` +
  'This adapter fetches phenology summary data for the most recently completed calendar year only.';

export interface UsaNpnRegistrationOptions {
  /** Strict per-call deadline (section 11) — configuration, never a constant invented here. */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets (section 14) — configuration, same reason. */
  readonly quotaLimits: ProviderQuotaLimits;
}

/**
 * The one registration a composition root adds to
 * `PlantAssertionProviderRegistry`. Takes a `Clock`, unlike
 * `createUsdaPlantsRegistration` — `usa-npn-adapter.ts`'s own header
 * explains why (the summarized-data query needs "the most recently
 * completed calendar year", which this adapter computes itself rather than
 * accepting as a parameter it does not have).
 */
export function createUsaNpnRegistration(
  options: UsaNpnRegistrationOptions,
  httpFetch: UsaNpnHttpFetch,
  clock: Clock,
): PlantAssertionProviderRegistration {
  return {
    metadata: {
      providerKey: USA_NPN_PROVIDER_KEY,
      displayName: USA_NPN_DISPLAY_NAME,
      licenseNote: LICENSE_NOTE,
      citationText: USA_NPN_CITATION,
      attributionText: USA_NPN_CITATION,
      fetchTimeoutMs: options.fetchTimeoutMs,
      quotaLimits: options.quotaLimits,
    },
    adapter: new UsaNpnAdapter(httpFetch, clock),
  };
}
