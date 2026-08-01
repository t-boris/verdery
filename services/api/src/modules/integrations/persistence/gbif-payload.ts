/**
 * GBIF response payloads → this module's normalized shapes.
 *
 * VERIFIED LIVE 2026-08-01 against `api.gbif.org`: a real name match for
 * "Quercus alba" returned `{usageKey: 2879737, canonicalName: "Quercus
 * alba", confidence: 98, matchType: "EXACT", status: "ACCEPTED", ...}`; an
 * unmatchable input returned `{confidence: 100, matchType: "NONE",
 * synonym: false}` — no `usageKey` at all, read as "nothing listed", never
 * a transport failure. A real occurrence facet query
 * (`/v1/occurrence/search?taxonKey=2879737&country=US&facet=stateProvince&facetLimit=5&limit=0`)
 * returned `{count: 51258, facets: [{field: "STATE_PROVINCE", counts:
 * [{name: "Massachusetts", count: 7191}, ...]}]}`; the same query against a
 * taxon with occurrences outside the requested `country=US` filter (a live
 * test against a mismatched taxonKey) returned real but off-topic facet
 * entries (a `"Mexico"` label under a `country=US` filter) — a reminder
 * that GBIF's own geographic labels are not validated against the request
 * filter, so `region` is passed through verbatim, never assumed accurate.
 *
 * SCOPE, per ADR-0016 section 4 ("never used to infer garden suitability
 * directly"): GBIF is occurrence EVIDENCE, not a distribution/status
 * claim — a documented sighting is not the same thing as USDA PLANTS'
 * `NativeStatuses` regulatory/botanical determination. This adapter
 * therefore only produces `NormalizedFactCandidate`s (occurrence counts,
 * evidence of presence); `fetchDistribution` always answers an empty array
 * (`gbif-adapter.ts`'s own header explains why, not this file's job to
 * repeat).
 *
 * PER-RECORD LICENSE, NOT PARSED HERE: a raw occurrence record's own
 * `license` field is mixed CC0/CC-BY/CC-BY-NC within one result set
 * (verified live, matching the runbook's own finding) — this adapter never
 * reads individual occurrence records, only the aggregate `facet` counts
 * above, so no per-record license ever needs to be read or stored. If a
 * future pass fetches individual records instead of facet counts, that pass
 * must read `license` per record, never assume one for the whole response.
 *
 * Source: docs/development/plant-knowledge-provider-runbooks.md, section 3.1;
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
 * section 4.
 */

import { z } from 'zod';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  NormalizedFactCandidate,
  ProviderTaxonCandidate,
} from '../application/plant-assertion-provider.js';

function malformed(detail: string): DependencyUnavailableError {
  return new DependencyUnavailableError(
    'integrations.gbif.malformed_response',
    `GBIF returned a payload this adapter cannot normalize: ${detail}.`,
  );
}

const speciesMatchPayloadSchema = z.object({
  usageKey: z.number().optional(),
  canonicalName: z.string().nullable().optional(),
  scientificName: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  matchType: z.string(),
});

/** No numeric key means "no match" — GBIF's own `matchType: "NONE"` case; confidence is normalized from GBIF's 0–100 scale into the domain's [0, 1]. */
export function parseGbifSpeciesMatchPayload(body: unknown): readonly ProviderTaxonCandidate[] {
  const parsed = speciesMatchPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed('its top-level shape is not the documented species-match object');
  }

  if (parsed.data.usageKey === undefined) {
    return [];
  }

  const rawConfidence = parsed.data.confidence;
  return [
    {
      providerTaxonId: String(parsed.data.usageKey),
      scientificName: parsed.data.canonicalName ?? parsed.data.scientificName ?? null,
      confidence:
        rawConfidence === null || rawConfidence === undefined ? null : rawConfidence / 100,
    },
  ];
}

const occurrenceFacetPayloadSchema = z.object({
  count: z.number(),
  facets: z
    .array(
      z.object({
        field: z.string(),
        counts: z.array(z.object({ name: z.string(), count: z.number() })),
      }),
    )
    .optional(),
});

/**
 * One fact for the nationwide total (`geographicScope: null`) plus one per
 * state/province the facet reports. An occurrence count is evidence of
 * documented sightings, not a status claim — `factKey` names it as such.
 */
export function parseGbifOccurrenceFacetPayload(body: unknown): readonly NormalizedFactCandidate[] {
  const parsed = occurrenceFacetPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed('its top-level shape is not the documented occurrence-search object');
  }

  const facts: NormalizedFactCandidate[] = [];
  if (parsed.data.count > 0) {
    facts.push({
      factKey: 'occurrence_evidence_count',
      value: String(parsed.data.count),
      unit: 'records',
      confidence: null,
      geographicScope: null,
    });
  }

  const stateProvinceFacet = (parsed.data.facets ?? []).find(
    (facet) => facet.field === 'STATE_PROVINCE',
  );
  for (const entry of stateProvinceFacet?.counts ?? []) {
    if (entry.count <= 0) {
      continue;
    }
    facts.push({
      factKey: 'occurrence_evidence_count',
      value: String(entry.count),
      unit: 'records',
      confidence: null,
      geographicScope: entry.name,
    });
  }
  return facts;
}
