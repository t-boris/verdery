/**
 * World Flora Online `matching_rest.php` response payload → this module's
 * normalized shapes.
 *
 * VERIFIED LIVE 2026-08-01 against `list.worldfloraonline.org`: a real
 * unambiguous search for "Quercus alba" returned `match: {wfo_id:
 * "wfo-0000289457", full_name_plain: "Quercus alba L.", placement:
 * "Code/Plantae/Pteridobiotina/Angiosperms/Fagales/Fagaceae/Quercus/Quercus/Quercus/alba"}`,
 * `candidates: []`; a deliberately ambiguous fuzzy search ("Quercus alva",
 * `fuzzy_name_parts=2`) returned `match: null` and a real `candidates[]`
 * array of ten-plus entries sharing the exact same `{wfo_id,
 * full_name_plain, placement}` shape as `match` (plus `full_name_html`,
 * which this adapter does not read); an unmatchable input
 * ("Zzzznonexistentplantxyz123") returned `match: null, candidates: []`
 * with HTTP 200 — read as "nothing listed", never a transport failure.
 *
 * `match` vs. `candidates`: WFO resolves unambiguous input directly into
 * `match` (a single candidate, even for a bare genus like "Quercus", when
 * exactly one taxon matches); `candidates` only carries entries when `match`
 * is `null` — the input matched more than one taxon, or none. This adapter
 * treats both the same way once normalized: `match`, when present, becomes
 * the sole search result; otherwise every `candidates` entry becomes one.
 * Neither carries a numeric match score — `confidence` is always `null`,
 * never invented from `candidates.length` or list position.
 *
 * SCOPE: this adapter answers ONLY `searchTaxa` — ADR-0016's "taxonomy
 * spine" role for this source is resolving an accepted name and its
 * hierarchical placement, not supplying facts or distribution/status
 * claims. WFO also publishes a GraphQL endpoint (`POST /gql.php`) the
 * runbook flags as better suited to a structured family/synonym fetch, but
 * live introspection this session found it undocumented and its exact
 * field names unverifiable without guessing at a schema this adapter would
 * then depend on — the same "treat as a source that can change without
 * notice" posture `usda-plants-payload.ts` already applies to an
 * undocumented API, applied here to leave `fetchFacts`/`fetchDistribution`
 * both returning an honest empty array (see `world-flora-online-adapter.ts`)
 * rather than parsing a schema nobody has confirmed.
 *
 * Source: docs/development/plant-knowledge-provider-runbooks.md, section 2.1.
 */

import { z } from 'zod';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { ProviderTaxonCandidate } from '../application/plant-assertion-provider.js';

function malformed(detail: string): DependencyUnavailableError {
  return new DependencyUnavailableError(
    'integrations.world_flora_online.malformed_response',
    `World Flora Online returned a payload this adapter cannot normalize: ${detail}.`,
  );
}

const matchEntrySchema = z.object({
  wfo_id: z.string(),
  full_name_plain: z.string(),
});

const matchingPayloadSchema = z.object({
  match: matchEntrySchema.nullable(),
  candidates: z.array(matchEntrySchema),
});

export function parseWorldFloraOnlineMatchPayload(
  body: unknown,
): readonly ProviderTaxonCandidate[] {
  const parsed = matchingPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed("its top-level shape is not the documented 'match'/'candidates' object");
  }

  const entries = parsed.data.match !== null ? [parsed.data.match] : parsed.data.candidates;
  return entries.map((entry) => ({
    providerTaxonId: entry.wfo_id,
    scientificName: entry.full_name_plain,
    confidence: null,
  }));
}
