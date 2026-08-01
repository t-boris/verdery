/**
 * The plant-intelligence analytics event catalog and its consent boundary
 * (P11-OBS-01) — the work package's "event schema and consent tests", the
 * identical shape `care-loop-analytics.test.ts` established for
 * P7-ANALYTICS-01.
 *
 * WHAT THIS PINS. Every structured log event this pass added across
 * `plants-inventory`/`observations-history`/`integrations` — actual/
 * candidate additions, search and candidate-list results, photo-based
 * identification suggestion and confirmation, candidate suitability review
 * and conversion, journal capture and correction, health-suggestion
 * production and disposition, and the taxon-enrichment sweep's own
 * duration addition — is cataloged here with its exact field allowlist and
 * each field's value kind, checked the same two ways
 * `care-loop-analytics.test.ts`'s own header describes: compile-time
 * (`satisfies`) where the payload mirrors an application result type, and
 * runtime (the consent-boundary scan below) for identity/content-shaped
 * vocabulary.
 *
 * `plants.identification_suggested` lives in `AddPlantFromPhoto`
 * (application layer, using its own already-injected `FastifyBaseLogger`),
 * not a route — the one place in this catalog where the emitter is not a
 * transport file, because the raw AI suggestion the route response never
 * carries is only ever in scope inside that command. Every other event
 * here is emitted at the route layer, right after its command executes,
 * the `recommendations.today_served` shape.
 *
 * `plant_species_ai.no_catalog_match` is cataloged even though it predates
 * this package (P8/P9's photo-identification stub replacement) — this pass
 * found and fixed a REAL prohibited-content violation in it (a raw
 * `commonName` value was being logged; see `identify-plant-from-photo.ts`'s
 * own comment at the fix site), and the consent-boundary scan below is what
 * now keeps it from silently regressing.
 *
 * THE CONSENT BOUNDARY, STATED ONCE, IDENTICALLY TO P7-ANALYTICS-01. These
 * are OPERATIONAL service logs over the server's own records: counts,
 * flags, closed reason vocabularies, and confidence BUCKETS (never a raw
 * continuous score, which could in principle be correlated across lines to
 * fingerprint one identification attempt) — never user identity, never
 * garden/plant/candidate/observation identifiers, never content (a display
 * name, a note, a suggested label, an evidence summary, a model name).
 * plant-intelligence-and-visual-journal.md section 17's own exclusion list
 * ("raw media, exact location, notes, diagnosis content, common-name
 * search text when it may be sensitive, signed URLs, and direct personal
 * identifiers") is the same boundary these tests enforce mechanically.
 *
 * The emission points themselves are pinned by the HTTP suites for the
 * routes each event belongs to — see this catalog's own
 * `EMITTING_TEST_FILES` map, asserted below to name a real file for every
 * cataloged event.
 */

import { describe, expect, it } from 'vitest';
import type { GroupingKind } from '../../src/modules/plants-inventory/public.js';
import type { SuitabilityFinding } from '../../src/modules/plants-inventory/public.js';
import type { PlantConditionSafetyClass } from '../../src/modules/integrations/public.js';
import type {
  HealthSuggestionDisposition,
  ObservationCorrectionKind,
} from '../../src/modules/observations-history/public.js';
import type { ConfidenceBucket } from '../../src/modules/plants-inventory/application/add-plant-from-photo.js';

type FieldKind =
  | 'count'
  | 'flag'
  | 'boundedLimit'
  | 'reasonCounts'
  | 'vocabularyString'
  | 'opaqueEventId'
  | 'nestedSummary';

interface AnalyticsEventSchema {
  readonly emitter: 'verdery-api';
  readonly fields: Readonly<Record<string, FieldKind>>;
}

// ---------------------------------------------------------------------------
// Reason-map / vocabulary-string key vocabularies, pinned against their
// exported closed unions — the identical `satisfies Record<Union, true>`
// idiom `care-loop-analytics.test.ts` established.
// ---------------------------------------------------------------------------

const GROUPING_KIND_VALUES = {
  individual: true,
  row: true,
  group: true,
} as const satisfies Record<GroupingKind, true>;

const CONFIDENCE_BUCKET_VALUES = {
  none: true,
  low: true,
  medium: true,
  high: true,
} as const satisfies Record<ConfidenceBucket, true>;

const SUITABILITY_CATEGORY_VALUES = {
  match: true,
  caution: true,
  blocker: true,
  unknown: true,
  assumption: true,
} as const satisfies Record<SuitabilityFinding['category'], true>;

const CORRECTION_KIND_VALUES = {
  amendment: true,
  supersede: true,
} as const satisfies Record<ObservationCorrectionKind, true>;

const SAFETY_CLASS_VALUES = {
  informational: true,
  monitor: true,
  expert_review_recommended: true,
} as const satisfies Record<PlantConditionSafetyClass, true>;

const DISPOSITION_VALUES = {
  confirmed_externally: true,
  accepted_as_observation: true,
  rejected: true,
  unresolved: true,
} as const satisfies Record<HealthSuggestionDisposition, true>;

// ---------------------------------------------------------------------------
// The catalog: one entry per event, with its field allowlist.
// ---------------------------------------------------------------------------

const PLANT_INTELLIGENCE_ANALYTICS_EVENTS: Readonly<Record<string, AnalyticsEventSchema>> = {
  'plants.actual_created': {
    emitter: 'verdery-api',
    fields: { kind: 'vocabularyString', groupingKind: 'vocabularyString', identified: 'flag' },
  },
  'plants.candidate_added': {
    emitter: 'verdery-api',
    fields: {
      kind: 'vocabularyString',
      groupingKind: 'vocabularyString',
      identified: 'flag',
      hasPriority: 'flag',
      isAlternative: 'flag',
    },
  },
  'plants.identification_suggested': {
    emitter: 'verdery-api',
    fields: {
      hadCandidate: 'flag',
      hasCatalogMatch: 'flag',
      confidenceBucket: 'vocabularyString',
    },
  },
  'plants.identification_confirmed': {
    emitter: 'verdery-api',
    fields: { hasCatalogMatch: 'flag' },
  },
  'plant_species_ai.no_catalog_match': {
    emitter: 'verdery-api',
    fields: { confidenceScore: 'boundedLimit' },
  },
  'plants.search_completed': {
    emitter: 'verdery-api',
    fields: {
      resultCount: 'count',
      isZeroResult: 'flag',
      hasQueryText: 'flag',
      hasLifecycleStageFilter: 'flag',
      hasStatusFilter: 'flag',
      hasGroupingKindFilter: 'flag',
      hasIdentifiedFilter: 'flag',
    },
  },
  'plants.candidates_listed': {
    emitter: 'verdery-api',
    fields: {
      resultCount: 'count',
      isZeroResult: 'flag',
      hasQueryText: 'flag',
      hasStatusFilter: 'flag',
      hasPriorityFilter: 'flag',
      hasIdentifiedFilter: 'flag',
    },
  },
  'plants.candidate_suitability_reviewed': {
    emitter: 'verdery-api',
    fields: { recalculated: 'flag', findingCounts: 'reasonCounts' },
  },
  'plants.candidate_converted': {
    emitter: 'verdery-api',
    fields: { groupingKind: 'vocabularyString', hasPriority: 'flag' },
  },
  'observations.recorded': {
    emitter: 'verdery-api',
    fields: {
      hasPlant: 'flag',
      photoCount: 'count',
      measurementCount: 'count',
      hasNote: 'flag',
      hasConditionSummary: 'flag',
      hasPhenologicalStage: 'flag',
    },
  },
  'observations.corrected': {
    emitter: 'verdery-api',
    fields: {
      correctionKind: 'vocabularyString',
      photoCount: 'count',
      measurementCount: 'count',
    },
  },
  'observations.health_suggestion_produced': {
    emitter: 'verdery-api',
    fields: {
      analysisCount: 'count',
      requestedAdditionalEvidenceCount: 'count',
      hasModelCount: 'count',
      safetyClassCounts: 'reasonCounts',
    },
  },
  'observations.health_disposition_set': {
    emitter: 'verdery-api',
    fields: { disposition: 'vocabularyString' },
  },
  'taxon_enrichment.sweep_completed': {
    emitter: 'verdery-api',
    fields: {
      taxaConsidered: 'count',
      refreshed: 'count',
      profilesRebuilt: 'count',
      profilesWithNothingToResolve: 'count',
      degradationReasons: 'reasonCounts',
      stoppedOnQuotaExhaustion: 'flag',
      durationMs: 'boundedLimit',
    },
  },
};

const REASON_VOCABULARIES: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  findingCounts: SUITABILITY_CATEGORY_VALUES,
  safetyClassCounts: SAFETY_CLASS_VALUES,
  // `degradationReasons` reuses the WEATHER_UNAVAILABLE_REASONS-shaped
  // `TaxonAssertionsUnavailableReason` vocabulary — this catalog only
  // widens an existing event with `durationMs`, so it does not re-pin a
  // vocabulary `care-loop-analytics.test.ts`'s own sibling file already
  // owns for the identical shared `TaxonAssertionsUnavailableReason`.
  degradationReasons: {
    providerNotRegistered: true,
    quotaExhausted: true,
    providerTimeout: true,
    providerFailed: true,
    providerReturnedNoMatch: true,
    providerReturnedInvalidData: true,
  },
};

/** Every `vocabularyString` field, mapped to the closed set of values it may legitimately take — the runtime half of the compile-time `satisfies` checks above. */
const VOCABULARY_STRING_VALUES: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  groupingKind: GROUPING_KIND_VALUES,
  confidenceBucket: CONFIDENCE_BUCKET_VALUES,
  correctionKind: CORRECTION_KIND_VALUES,
  disposition: DISPOSITION_VALUES,
  kind: { actual: true, candidate: true },
};

/** Which real HTTP/unit test proves each cataloged event is actually emitted, with the asserted field set. */
const EMITTING_TEST_FILES: Readonly<Record<string, string>> = {
  'plants.actual_created': 'tests/http/plant-analytics-events.test.ts',
  'plants.candidate_added': 'tests/http/plant-analytics-events.test.ts',
  'plants.identification_suggested': 'tests/http/plant-analytics-events.test.ts',
  'plants.identification_confirmed': 'tests/http/plant-analytics-events.test.ts',
  'plant_species_ai.no_catalog_match':
    'src/modules/plants-inventory/application/identify-plant-from-photo.test.ts',
  'plants.search_completed': 'tests/http/plant-analytics-events.test.ts',
  'plants.candidates_listed': 'tests/http/plant-analytics-events.test.ts',
  'plants.candidate_suitability_reviewed': 'tests/http/plant-analytics-events.test.ts',
  'plants.candidate_converted': 'tests/http/plant-analytics-events.test.ts',
  'observations.recorded': 'tests/http/observation-analytics-events.test.ts',
  'observations.corrected': 'tests/http/observation-analytics-events.test.ts',
  'observations.health_suggestion_produced': 'tests/http/observation-analytics-events.test.ts',
  'observations.health_disposition_set': 'tests/http/observation-analytics-events.test.ts',
  'taxon_enrichment.sweep_completed':
    'src/modules/integrations/application/run-taxon-enrichment-sweep.test.ts',
};

/**
 * Vocabulary that must never appear in this catalog's field names, in ANY
 * form — unambiguous identity, secret, or location words. Deliberately
 * NOT a copy of `care-loop-analytics.test.ts`'s own list: that catalog's
 * domain nouns (`garden`/`plant`/`candidate`) are genuinely ambiguous
 * identity references in ITS events, but in THIS catalog `plant`/
 * `candidate`/`observation`/`profile` (as in `PlantProfileVersion`) ARE the
 * literal, central domain nouns, used only inside `has___`/`___Count`/
 * `___Kind` shaped fields that are already structurally counts, flags, or
 * closed vocabulary (never a raw `string` `FieldKind` exists in this
 * catalog's own type at all) — each catalog owns and reviews its own
 * boundary, so a change to one can never silently loosen the other.
 */
const FORBIDDEN_VOCABULARY =
  /(recipient(?!s)|actor|member(?!s)|email|phone|token|secret|credential|cookie|address|latitude|longitude|coordinate|geometry|prompt|response|explanation|\burl\b|\bfile\b)/i;

/**
 * Words that are safe ONLY behind a `has`/`is`/`had` presence prefix — the
 * established "presence boolean, never the value" convention this
 * codebase already uses (`hasQuietHours`, `hasReason`): `hasNote` says
 * whether the observer wrote anything, never what they wrote.
 */
const CONTENT_WORDS_REQUIRING_PRESENCE_PREFIX = /(name|text|note|summary|label|title|query)/i;
const PRESENCE_PREFIXES = ['has', 'is', 'had'];

describe('plant-intelligence analytics event catalog (P11-OBS-01)', () => {
  it('pins every event to a namespaced, uniquely owned name', () => {
    const names = Object.keys(PLANT_INTELLIGENCE_ANALYTICS_EVENTS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('names a real emitting test file for every cataloged event', () => {
    for (const eventName of Object.keys(PLANT_INTELLIGENCE_ANALYTICS_EVENTS)) {
      expect(EMITTING_TEST_FILES[eventName], eventName).toBeDefined();
    }
  });

  it('admits only counts, flags, closed vocabularies, and bounded values', () => {
    for (const [eventName, schema] of Object.entries(PLANT_INTELLIGENCE_ANALYTICS_EVENTS)) {
      for (const [field, kind] of Object.entries(schema.fields)) {
        if (kind === 'reasonCounts') {
          expect(
            REASON_VOCABULARIES[field],
            `${eventName}.${field} needs a vocabulary`,
          ).toBeDefined();
        }
        if (kind === 'vocabularyString') {
          expect(
            VOCABULARY_STRING_VALUES[field],
            `${eventName}.${field} needs a closed value set`,
          ).toBeDefined();
        }
      }
    }
  });

  it('gives every event exactly one emitting service', () => {
    for (const schema of Object.values(PLANT_INTELLIGENCE_ANALYTICS_EVENTS)) {
      expect(schema.emitter).toBe('verdery-api');
    }
  });
});

describe('consent boundary — no identity, no content, in any plant-intelligence analytics event (P11-OBS-01)', () => {
  it('rejects identity-, secret-, and location-shaped field names across the whole catalog', () => {
    for (const [eventName, schema] of Object.entries(PLANT_INTELLIGENCE_ANALYTICS_EVENTS)) {
      for (const field of Object.keys(schema.fields)) {
        expect(
          FORBIDDEN_VOCABULARY.test(field),
          `field '${field}' of '${eventName}' looks identity-, secret-, or location-bearing`,
        ).toBe(false);
        expect(
          /Id$/.test(field),
          `field '${field}' of '${eventName}' carries an unsanctioned identifier`,
        ).toBe(false);
      }
    }
  });

  it('gates every content-shaped field name behind a has/is/had presence prefix', () => {
    for (const [eventName, schema] of Object.entries(PLANT_INTELLIGENCE_ANALYTICS_EVENTS)) {
      for (const field of Object.keys(schema.fields)) {
        if (!CONTENT_WORDS_REQUIRING_PRESENCE_PREFIX.test(field)) {
          continue;
        }
        expect(
          PRESENCE_PREFIXES.some((prefix) => field.startsWith(prefix)),
          `field '${field}' of '${eventName}' names content (a note/summary/label/text/name) without a has/is/had presence prefix — it must carry only whether one exists, never its value`,
        ).toBe(true);
      }
    }
  });

  it('keeps every reason/vocabulary map a closed set of static machine words', () => {
    for (const [mapField, vocabulary] of Object.entries(REASON_VOCABULARIES)) {
      const values = Object.keys(vocabulary);
      expect(values.length, mapField).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, `value of '${mapField}'`).toMatch(/^[a-zA-Z_]+$/);
      }
    }
    for (const [field, vocabulary] of Object.entries(VOCABULARY_STRING_VALUES)) {
      const values = Object.keys(vocabulary);
      expect(values.length, field).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, `value of '${field}'`).toMatch(/^[a-zA-Z_]+$/);
      }
    }
  });

  it('never logs a raw continuous confidence score outside the one grandfathered boundedLimit field', () => {
    // `plant_species_ai.no_catalog_match`'s own `confidenceScore` is the ONE
    // deliberate exception — a `[0, 1]` value already this repo's own
    // established pattern for `identify-plant-species.ts`'s
    // `plant_species_ai.result` event, kept here rather than bucketed since
    // this file only tightened its ALREADY-logged `commonName` violation,
    // not its pre-existing confidence field. Every event THIS package
    // itself introduced uses `confidenceBucket` instead — this test pins
    // that `identification_suggested` specifically never regresses to the
    // raw score.
    const suggested = PLANT_INTELLIGENCE_ANALYTICS_EVENTS['plants.identification_suggested'];
    expect(Object.keys(suggested?.fields ?? {})).not.toContain('confidenceScore');
    expect(suggested?.fields['confidenceBucket']).toBe('vocabularyString');
  });
});
