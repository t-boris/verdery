/**
 * USDA PLANTS response payloads → this module's normalized shapes.
 *
 * Everything vendor-shaped about USDA PLANTS lives here and in
 * `usda-plants-adapter.ts` ("Provider SDK and payload types remain inside
 * the adapter", external-integrations.md section 2).
 *
 * VERIFIED LIVE 2026-07-31 against `plantsservices.sc.egov.usda.gov`
 * (the same undocumented-but-real internal API
 * `docs/development/plant-knowledge-provider-runbooks.md` section 2.2
 * records): a real search for "Quercus alba" returned `Id: 70172`,
 * `Symbol: "QUAL"`, `ScientificNameWithoutAuthor: "Quercus alba"` (plain
 * text — unlike `ScientificName`, which embeds `<i>...</i>` markup around
 * the epithet, so this field is used instead of stripping HTML); a real
 * profile fetch for that id returned `NativeStatuses: [{Region: "CAN",
 * Status: "N", Type: "Native"}, {Region: "L48", Status: "N", Type:
 * "Native"}]`; a real characteristics fetch returned flat `{
 * PlantCharacteristicName, PlantCharacteristicValue, PlantCharacteristicCategory
 * }` triples; a real noxious-status fetch for a known-listed species (id
 * 84414, purple loosestrife) returned `[{LocalityName: "Alabama",
 * NoxiousStatuses: ["Class B"]}, ...]`, and the equivalent invasive-status
 * fetch returned the parallel `InvasiveStatuses` shape. A species with
 * neither status (verified against id 70172) returns `[]` with HTTP 200 —
 * not a 404 — so an empty array is read as "nothing listed", never a
 * transport failure.
 *
 * `factKey` DERIVATION: USDA PLANTS' own characteristic names are free-text
 * English ("Active Growth Period", "C:N Ratio") with no existing stable
 * identifier. Deterministically slugified (lowercase, non-alphanumeric runs
 * collapsed to a single underscore) rather than hand-mapped one by one — the
 * open `factKey` vocabulary `plant-fact-assertion.ts` already documents
 * tolerates this; a hand-curated rename table is a later refinement, not a
 * correctness requirement, since nothing downstream matches on a specific
 * `factKey` string this pass (the suitability rule catalog's three rules
 * read `garden_context_fact`/profile facts by their OWN keys, none of which
 * are USDA Characteristics names yet).
 *
 * DISTRIBUTION STATUS MAPPING: `NativeStatuses[].Type` is either `"Native"`
 * or `"Introduced"` verbatim (mapped directly to the domain's own
 * `'native'`/`'introduced'`); a noxious-weed state listing is a genuine
 * regulatory designation (mapped to `'regulated'`); an invasive-species
 * state listing is mapped to `'invasive'`. `Region`/`LocalityName` are
 * passed through verbatim as `region` — the two USDA endpoints use
 * different region vocabularies (multi-state aggregate codes like `"L48"`
 * for native status, full state names like `"Alabama"` for noxious/
 * invasive), and neither is normalized into the other here: `region` is an
 * open string in the domain, not a closed enum, and inventing a shared
 * vocabulary this pass would be guessing at a mapping USDA itself does not
 * publish.
 */

import { z } from 'zod';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  NormalizedDistributionCandidate,
  NormalizedFactCandidate,
  ProviderTaxonCandidate,
} from '../application/plant-assertion-provider.js';

function malformed(detail: string): DependencyUnavailableError {
  return new DependencyUnavailableError(
    'integrations.usda_plants.malformed_response',
    `USDA PLANTS returned a payload this adapter cannot normalize: ${detail}.`,
  );
}

const searchResultSchema = z.object({
  Id: z.number(),
  Symbol: z.string(),
  ScientificNameWithoutAuthor: z.string().nullable().optional(),
});
const searchPayloadSchema = z.object({
  PlantResults: z.array(searchResultSchema),
});

/** Search results carry no provider-reported confidence — always `null`, never invented. */
export function parseUsdaPlantsSearchPayload(body: unknown): readonly ProviderTaxonCandidate[] {
  const parsed = searchPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed("its top-level shape is not the documented 'PlantResults' array");
  }

  return parsed.data.PlantResults.map((result) => ({
    providerTaxonId: String(result.Id),
    scientificName: result.ScientificNameWithoutAuthor ?? null,
    confidence: null,
  }));
}

const characteristicSchema = z.object({
  PlantCharacteristicName: z.string(),
  PlantCharacteristicValue: z.string().nullable(),
});
const characteristicsPayloadSchema = z.array(characteristicSchema);

function slugifyFactKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Skips a row whose value is `null`/blank rather than storing an empty fact
 * — "Missing facts remain missing", applied per row, the same partial-
 * degradation posture `open-meteo-payload.ts`'s own header documents for a
 * dropped measurement.
 */
export function parseUsdaPlantsCharacteristicsPayload(
  body: unknown,
): readonly NormalizedFactCandidate[] {
  const parsed = characteristicsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed('its top-level shape is not the documented characteristics array');
  }

  const facts: NormalizedFactCandidate[] = [];
  for (const row of parsed.data) {
    const value = row.PlantCharacteristicValue?.trim();
    const factKey = slugifyFactKey(row.PlantCharacteristicName);
    if (value === undefined || value.length === 0 || factKey.length === 0) {
      continue;
    }
    facts.push({ factKey, value, unit: null, confidence: null, geographicScope: null });
  }
  return facts;
}

const nativeStatusSchema = z.object({
  Region: z.string(),
  Type: z.string(),
});
const profilePayloadSchema = z.object({
  NativeStatuses: z.array(nativeStatusSchema).nullable().optional(),
});

const localityStatusesSchema = z.array(
  z.object({
    LocalityName: z.string(),
    NoxiousStatuses: z.array(z.string()).nullable().optional(),
    InvasiveStatuses: z.array(z.string()).nullable().optional(),
  }),
);

export function parseUsdaPlantsProfileNativeStatuses(
  body: unknown,
): readonly NormalizedDistributionCandidate[] {
  const parsed = profilePayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed('its top-level shape is not the documented profile object');
  }

  return (parsed.data.NativeStatuses ?? [])
    .filter((entry) => entry.Type === 'Native' || entry.Type === 'Introduced')
    .map((entry) => ({
      region: entry.Region,
      rawStatus: entry.Type === 'Native' ? 'native' : 'introduced',
      confidence: null,
    }));
}

function parseLocalityStatuses(
  body: unknown,
  field: 'NoxiousStatuses' | 'InvasiveStatuses',
  rawStatus: 'regulated' | 'invasive',
  errorDetail: string,
): readonly NormalizedDistributionCandidate[] {
  const parsed = localityStatusesSchema.safeParse(body);
  if (!parsed.success) {
    throw malformed(errorDetail);
  }

  const candidates: NormalizedDistributionCandidate[] = [];
  for (const entry of parsed.data) {
    const statuses = entry[field] ?? [];
    if (statuses.length === 0) {
      continue;
    }
    candidates.push({ region: entry.LocalityName, rawStatus, confidence: null });
  }
  return candidates;
}

export function parseUsdaPlantsNoxiousStatuses(
  body: unknown,
): readonly NormalizedDistributionCandidate[] {
  return parseLocalityStatuses(
    body,
    'NoxiousStatuses',
    'regulated',
    'its top-level shape is not the documented noxious-status array',
  );
}

export function parseUsdaPlantsInvasiveStatuses(
  body: unknown,
): readonly NormalizedDistributionCandidate[] {
  return parseLocalityStatuses(
    body,
    'InvasiveStatuses',
    'invasive',
    'its top-level shape is not the documented invasive-status array',
  );
}
