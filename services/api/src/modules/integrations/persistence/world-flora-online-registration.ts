/**
 * The World Flora Online registry entry — the `PlantAssertionProviderMetadata`
 * the registry validates and `refresh-taxon-assertions.ts` snapshots onto
 * every mapping/assertion it writes as `sourceCitation`.
 *
 * THE TERMS — A CORRECTION TO THE RUNBOOK, found live 2026-08-01: the
 * `worldfloraonline.org` site footer states "Unless otherwise noted, text
 * and images are licenced: CC BY 4.0", not the CC0 dedication `docs/
 * development/plant-knowledge-provider-runbooks.md` section 2.1 recorded
 * ("confirmed on the site's own download page" — that page's own separate
 * DOI/Zenodo licensing may differ from the live site footer this
 * registration was built against; the discrepancy itself, not either
 * reading alone, is what should be reconfirmed with WFO directly before
 * this adapter is enabled outside development). CC BY 4.0 REQUIRES
 * attribution, unlike CC0 — `attributionText` is therefore non-null here,
 * unlike `createUsdaPlantsRegistration`'s `null`. The footer's own
 * recommended citation form (verified live, same date): "WFO (2026): World
 * Flora Online. Published on the Internet; http://www.worldfloraonline.org.
 * Accessed on: [date]." — the bracketed date is per-access, not a fixed
 * string, so it is deliberately omitted from the stored text below rather
 * than baked in as a stale "Accessed on: 2026-08-01" that would mislead
 * every later reader of a stored assertion's provenance.
 */

import type { ProviderQuotaLimits } from '../application/provider-quota-repository.js';
import type { PlantAssertionProviderRegistration } from '../application/plant-assertion-provider-registry.js';
import type { WorldFloraOnlineHttpFetch } from './world-flora-online-adapter.js';
import { WorldFloraOnlineAdapter } from './world-flora-online-adapter.js';

/** Application-owned stable key — stamped as `provider_key` on every mapping/assertion this adapter produces. */
export const WORLD_FLORA_ONLINE_PROVIDER_KEY = 'world-flora-online';

export const WORLD_FLORA_ONLINE_DISPLAY_NAME = 'World Flora Online';

/** WFO's own recommended citation FORM, from its site footer — the "[date]" placeholder is intentionally left unfilled; see this file's own header. */
export const WORLD_FLORA_ONLINE_CITATION =
  'WFO (2026): World Flora Online. Published on the Internet; http://www.worldfloraonline.org. ' +
  'Accessed on: [date of use].';

const LICENSE_NOTE =
  'CC BY 4.0, per the live worldfloraonline.org site footer (verified 2026-08-01) — attribution ' +
  'is required. This corrects an earlier CC0 reading recorded in docs/development/plant-knowledge-' +
  `provider-runbooks.md section 2.1; recommended citation: ${WORLD_FLORA_ONLINE_CITATION} This ` +
  'adapter fetches only accepted-name and classification-placement identity, never imagery.';

const ATTRIBUTION_TEXT = `World Flora Online (worldfloraonline.org), CC BY 4.0. Cite as: ${WORLD_FLORA_ONLINE_CITATION}`;

export interface WorldFloraOnlineRegistrationOptions {
  /** Strict per-call deadline (section 11) — configuration, never a constant invented here. */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets (section 14) — configuration, same reason. */
  readonly quotaLimits: ProviderQuotaLimits;
}

/**
 * The one registration a composition root adds to
 * `PlantAssertionProviderRegistry`. No clock parameter, the same
 * `createUsdaPlantsRegistration` reasoning: this adapter stamps no
 * timestamp of its own.
 */
export function createWorldFloraOnlineRegistration(
  options: WorldFloraOnlineRegistrationOptions,
  httpFetch: WorldFloraOnlineHttpFetch,
): PlantAssertionProviderRegistration {
  return {
    metadata: {
      providerKey: WORLD_FLORA_ONLINE_PROVIDER_KEY,
      displayName: WORLD_FLORA_ONLINE_DISPLAY_NAME,
      licenseNote: LICENSE_NOTE,
      citationText: WORLD_FLORA_ONLINE_CITATION,
      attributionText: ATTRIBUTION_TEXT,
      fetchTimeoutMs: options.fetchTimeoutMs,
      quotaLimits: options.quotaLimits,
    },
    adapter: new WorldFloraOnlineAdapter(httpFetch),
  };
}
