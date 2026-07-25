/**
 * The care-loop analytics event catalog and its consent boundary
 * (P7-ANALYTICS-01) — the work package's "event schema and consent tests".
 *
 * WHAT THIS PINS. Every analytics-relevant structured event the care loop
 * emits (presentation, generation freshness and degradation, notification
 * suppression and delivery, AI fallback) is cataloged here with its exact
 * field allowlist and each field's value kind. The allowlists are checked
 * two ways:
 *
 * 1. AT COMPILE TIME — each allowlist whose payload is an application
 *    result type is declared `satisfies Record<keyof Result, FieldKind>`,
 *    so adding, removing, or renaming a field in the emitting code no
 *    longer type-checks until this catalog (and therefore this review
 *    surface) is updated. The reason-map key vocabularies are pinned the
 *    same way against their exported unions.
 * 2. AT RUNTIME — the consent-boundary tests below scan every cataloged
 *    field name and reason vocabulary for identity- and content-shaped
 *    vocabulary, so a field like `profileId` or `explanationText` cannot
 *    enter any analytics event without failing this suite.
 *
 * The emission points themselves are pinned by the HTTP suites
 * (`tests/http/recommendation-routes.test.ts` for
 * `recommendations.today_served`,
 * `tests/http/notification-analytics-events.test.ts` for the notification
 * events), which assert the emitted lines' exact key sets match these
 * allowlists.
 *
 * THE CONSENT BOUNDARY, STATED ONCE. These events are OPERATIONAL service
 * logs over the server's own records: per-request or per-run counts, typed
 * reason vocabularies, and opaque machine identifiers — never user
 * identity, never garden/candidate/plant identifiers, never content
 * (observability-and-analytics.md sections 10-11: "Technical logs
 * necessary for security and service operation" versus consent-governed
 * product events). The CONSENTED client-side product-analytics half of
 * P7-ANALYTICS-01 (per-user behavior events such as section 10's
 * "Recommendation presented/completed/postponed/rejected") deliberately
 * does not exist anywhere in this codebase: it is blocked on the undecided
 * consent model (P0-SEC-01) and recorded in
 * docs/development/deferred-capabilities.md — absent, not half-built, so
 * there is no consent-gate mechanism to test beyond proving these server
 * events need none.
 */

import { describe, expect, it } from 'vitest';
import type { NotificationEventProcessingSummary } from '@verdery/api-contracts';
import type {
  WeatherRefreshSweepResult,
  WeatherUnavailableReason,
} from '../../src/modules/integrations/public.js';
import type {
  DeliveryFailReason,
  EventSuppressionReason,
  NotificationDeliverySweepResult,
  PushSendOutcome,
  RecipientSuppressionReason,
  SendTimeSkipReason,
} from '../../src/modules/notifications/public.js';
import type {
  AiExplanationValidationOutcome,
  EmbellishmentRunResult,
  RecommendationEvaluationSweepResult,
  RuleSkipReason,
  TodayViewOutcome,
} from '../../src/modules/tasks-recommendations/public.js';

/**
 * What a field is allowed to carry:
 * - `count` — a non-negative integer aggregate.
 * - `flag` — a boolean state of the run itself.
 * - `boundedLimit` — the request's own bounded numeric parameter.
 * - `reasonCounts` — a map from a CLOSED typed reason vocabulary to counts.
 * - `vocabularyString` — one value of a closed machine vocabulary.
 * - `opaqueEventId` — an opaque machine event identifier (an outbox row
 *   id), carried for poisoned-event debugging; never a user-scoped id.
 * - `nestedSummary` — a nested allowlisted summary object (or null).
 */
type FieldKind =
  | 'count'
  | 'flag'
  | 'boundedLimit'
  | 'reasonCounts'
  | 'vocabularyString'
  | 'opaqueEventId'
  | 'nestedSummary';

// ---------------------------------------------------------------------------
// Compile-time pinned allowlists (drift in the result types fails the build).
// ---------------------------------------------------------------------------

const TODAY_SERVED_OUTCOME_KEYS = {
  result: true,
  firstPresentations: true,
} as const satisfies Record<keyof TodayViewOutcome, true>;

/** `recommendations.today_served` — route-composed from `TodayViewOutcome`; `result` is the HTTP response body, not a log field. */
const TODAY_SERVED_FIELDS: Readonly<Record<string, FieldKind>> = {
  itemsServed: 'count',
  firstPresentations: 'count',
  limit: 'boundedLimit',
};

const WEATHER_REFRESH_SWEEP_FIELDS = {
  gardensConsidered: 'count',
  refreshed: 'count',
  freshCacheHits: 'count',
  staleServed: 'count',
  unavailable: 'count',
  degradationReasons: 'reasonCounts',
  stoppedOnQuotaExhaustion: 'flag',
} as const satisfies Record<keyof WeatherRefreshSweepResult, FieldKind>;

const EMBELLISHMENT_FIELDS = {
  candidatesConsidered: 'count',
  accepted: 'count',
  rejected: 'count',
  rejectionOutcomes: 'reasonCounts',
  transientFailures: 'count',
  lostRaces: 'count',
  stoppedOnQuotaExhaustion: 'flag',
} as const satisfies Record<keyof EmbellishmentRunResult, FieldKind>;

const EVALUATION_SWEEP_FIELDS = {
  gardensEvaluated: 'count',
  candidatesCreated: 'count',
  candidatesSuperseded: 'count',
  candidatesExpired: 'count',
  lostRaces: 'count',
  ruleSkips: 'reasonCounts',
  embellishment: 'nestedSummary',
} as const satisfies Record<keyof RecommendationEvaluationSweepResult, FieldKind>;

const EVENT_PROCESSED_SUMMARY_FIELDS = {
  eventType: 'vocabularyString',
  recipientsConsidered: 'count',
  intentsCreated: 'count',
  intentsDeduplicated: 'count',
  suppressed: 'reasonCounts',
  priorIntentsSuperseded: 'count',
} as const satisfies Record<keyof NotificationEventProcessingSummary, FieldKind>;

const DELIVERY_SWEEP_FIELDS = {
  intentsExpired: 'count',
  intentsClaimed: 'count',
  intentsSent: 'count',
  intentsSkipped: 'reasonCounts',
  intentsFailed: 'reasonCounts',
  intentsDeferred: 'count',
  retriesScheduled: 'count',
  attemptOutcomes: 'reasonCounts',
  devicesDisabled: 'count',
  lostRaces: 'count',
} as const satisfies Record<keyof NotificationDeliverySweepResult, FieldKind>;

// ---------------------------------------------------------------------------
// Reason-map key vocabularies, pinned against their exported unions.
// ---------------------------------------------------------------------------

const RULE_SKIP_REASON_KINDS = {
  weatherMissing: true,
  weatherStale: true,
  factMissing: true,
} as const satisfies Record<RuleSkipReason['kind'], true>;

const WEATHER_UNAVAILABLE_REASONS = {
  noProviderConfigured: true,
  gardenNotGeoreferenced: true,
  quotaExhausted: true,
  providerTimeout: true,
  providerFailed: true,
  providerReturnedNoData: true,
  providerReturnedInvalidData: true,
} as const satisfies Record<WeatherUnavailableReason, true>;

const AI_REJECTION_OUTCOMES = {
  accepted: true,
  schema_invalid: true,
  provider_safety_blocked: true,
  unknown_evidence_reference: true,
  unsupported_action: true,
  unsupported_fact: true,
  prohibited_content: true,
  length_exceeded: true,
} as const satisfies Record<AiExplanationValidationOutcome, true>;

const EVENT_SUPPRESSION_REASONS = {
  candidate_missing: true,
  candidate_not_live: true,
  candidate_window_passed: true,
  account_not_usable: true,
  channels_disabled: true,
} as const satisfies Record<EventSuppressionReason | RecipientSuppressionReason, true>;

const SEND_TIME_SKIP_REASONS = {
  recipient_access_revoked: true,
  account_not_usable: true,
  push_channel_disabled: true,
  no_active_device: true,
  candidate_missing: true,
  candidate_not_live: true,
  candidate_window_passed: true,
} as const satisfies Record<SendTimeSkipReason, true>;

const PUSH_ATTEMPT_OUTCOME_KINDS = {
  accepted: true,
  token_invalid: true,
  transient_failure: true,
  permanent_failure: true,
} as const satisfies Record<PushSendOutcome['kind'], true>;

const DELIVERY_FAIL_REASONS = {
  retry_budget_exhausted: true,
  provider_permanent_failure: true,
  all_tokens_invalid: true,
} as const satisfies Record<DeliveryFailReason, true>;

// ---------------------------------------------------------------------------
// The catalog: one entry per analytics-relevant event, with its emitter.
// ---------------------------------------------------------------------------

interface AnalyticsEventSchema {
  /** The one service whose logs carry this event — a log-based metric filters on it, and no second service may emit the same name. */
  readonly emitter: 'verdery-api' | 'verdery-workers';
  readonly fields: Readonly<Record<string, FieldKind>>;
}

const CARE_LOOP_ANALYTICS_EVENTS: Readonly<Record<string, AnalyticsEventSchema>> = {
  'recommendations.today_served': { emitter: 'verdery-api', fields: TODAY_SERVED_FIELDS },
  'weather.refresh_sweep_completed': {
    emitter: 'verdery-workers',
    fields: WEATHER_REFRESH_SWEEP_FIELDS,
  },
  'recommendations.evaluation_sweep_completed': {
    emitter: 'verdery-workers',
    fields: EVALUATION_SWEEP_FIELDS,
  },
  'notifications.event_processed': {
    emitter: 'verdery-api',
    // The route adds the outbox row's id to the summary it logs — the one
    // sanctioned opaque identifier (see `FieldKind`).
    fields: { ...EVENT_PROCESSED_SUMMARY_FIELDS, sourceEventId: 'opaqueEventId' },
  },
  'notifications.intents_expired': {
    emitter: 'verdery-api',
    fields: { intentsExpired: 'count' },
  },
  'notifications.preferences_updated': {
    emitter: 'verdery-api',
    fields: { revision: 'count', entryCount: 'count', hasQuietHours: 'flag' },
  },
  'notifications.delivery_sweep_completed': {
    emitter: 'verdery-workers',
    fields: DELIVERY_SWEEP_FIELDS,
  },
};

/** Fields of kind `nestedSummary` resolve here — the nested object's own allowlist, held to the same boundary as top-level fields. */
const NESTED_SUMMARIES: Readonly<Record<string, Readonly<Record<string, FieldKind>>>> = {
  embellishment: EMBELLISHMENT_FIELDS,
};

const REASON_VOCABULARIES: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  ruleSkips: RULE_SKIP_REASON_KINDS,
  degradationReasons: WEATHER_UNAVAILABLE_REASONS,
  rejectionOutcomes: AI_REJECTION_OUTCOMES,
  suppressed: EVENT_SUPPRESSION_REASONS,
  intentsSkipped: SEND_TIME_SKIP_REASONS,
  intentsFailed: DELIVERY_FAIL_REASONS,
  attemptOutcomes: PUSH_ATTEMPT_OUTCOME_KINDS,
};

/**
 * Vocabulary that must never appear in an analytics event's field names or
 * reason values: user and recipient identity, per-record identifiers,
 * secrets, location, and content. `garden(?!s[A-Z])` still admits the
 * aggregate `gardensConsidered`/`gardensEvaluated` counters while
 * rejecting any singular `garden...` reference.
 */
const FORBIDDEN_VOCABULARY =
  /(profile|recipient(?!s)|user|actor|member|email|phone|display|garden(?!s[A-Z])|plant(?!s[A-Z])|candidate(?!s)|task(?!s[A-Z])|observation|media|token|secret|credential|cookie|address|latitude|longitude|coordinate|geometry|text|title|name|note|prompt|response|explanation|url|file)/i;

/** Opaque machine ids must be consciously exempted; anything else ending in `Id` is treated as a record reference and refused. */
const OPAQUE_ID_EXEMPTIONS: ReadonlySet<string> = new Set(['sourceEventId']);

describe('care-loop analytics event catalog (P7-ANALYTICS-01)', () => {
  it('pins every event to a namespaced, uniquely owned name', () => {
    const names = Object.keys(CARE_LOOP_ANALYTICS_EVENTS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      // module.event_name — the established structured-event convention.
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the Today outcome exactly the served resource plus the presentation counter', () => {
    // Compile-time: `satisfies` above; runtime: the catalog's own record.
    expect(Object.keys(TODAY_SERVED_OUTCOME_KEYS).sort()).toEqual(['firstPresentations', 'result']);
    expect(Object.keys(TODAY_SERVED_FIELDS).sort()).toEqual([
      'firstPresentations',
      'itemsServed',
      'limit',
    ]);
  });

  it('admits only counts, flags, closed vocabularies, and the sanctioned opaque event id', () => {
    for (const [eventName, schema] of Object.entries(CARE_LOOP_ANALYTICS_EVENTS)) {
      for (const [field, kind] of Object.entries(schema.fields)) {
        if (kind === 'opaqueEventId') {
          expect(OPAQUE_ID_EXEMPTIONS.has(field), `${eventName}.${field}`).toBe(true);
        }
        if (kind === 'reasonCounts') {
          expect(
            REASON_VOCABULARIES[field],
            `${eventName}.${field} needs a vocabulary`,
          ).toBeDefined();
        }
        if (kind === 'nestedSummary') {
          const nested = NESTED_SUMMARIES[field];
          expect(nested, `${eventName}.${field} needs a nested allowlist`).toBeDefined();
          for (const [nestedField, nestedKind] of Object.entries(nested ?? {})) {
            expect(nestedKind, `${eventName}.${field}.${nestedField}`).not.toBe('nestedSummary');
            if (nestedKind === 'reasonCounts') {
              expect(
                REASON_VOCABULARIES[nestedField],
                `${eventName}.${field}.${nestedField} needs a vocabulary`,
              ).toBeDefined();
            }
          }
        }
      }
    }
  });
});

describe('consent boundary — no identity, no content, in any analytics event (P7-ANALYTICS-01)', () => {
  it('rejects identity- and content-shaped field names across the whole catalog', () => {
    const fieldSets: [string, readonly string[]][] = [
      ...Object.entries(CARE_LOOP_ANALYTICS_EVENTS).map(
        ([eventName, schema]): [string, readonly string[]] => [
          eventName,
          Object.keys(schema.fields),
        ],
      ),
      ...Object.entries(NESTED_SUMMARIES).map(([field, nested]): [string, readonly string[]] => [
        `nested '${field}'`,
        Object.keys(nested),
      ]),
    ];
    for (const [eventName, fields] of fieldSets) {
      for (const field of fields) {
        expect(
          FORBIDDEN_VOCABULARY.test(field),
          `field '${field}' of '${eventName}' looks identity- or content-bearing`,
        ).toBe(false);
        if (/Id$/.test(field)) {
          expect(
            OPAQUE_ID_EXEMPTIONS.has(field),
            `field '${field}' of '${eventName}' carries an unsanctioned identifier`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps every reason vocabulary a closed set of static machine words', () => {
    // Reason VALUES legitimately name entity classes ('candidate_missing',
    // 'gardenNotGeoreferenced', 'token_invalid') — the boundary for them is
    // different from field names: each vocabulary is compile-pinned above
    // against its exported closed union (so no reason can be interpolated
    // from data), and every word must be a static identifier — no spaces,
    // no digits, nothing that could smuggle a value.
    for (const [mapField, vocabulary] of Object.entries(REASON_VOCABULARIES)) {
      const reasons = Object.keys(vocabulary);
      expect(reasons.length, mapField).toBeGreaterThan(0);
      for (const reason of reasons) {
        expect(reason, `reason of '${mapField}'`).toMatch(/^[a-zA-Z_]+$/);
      }
    }
  });

  it('gives every event exactly one emitting service — a metric on the event name can never double-count', () => {
    // The regression this pins: `notifications.delivery_sweep_completed`
    // was briefly emitted by BOTH the API route and the worker trigger;
    // the catalog is the single place stating which service owns each
    // name, and the sweep events all belong to the worker trigger
    // (`GoogleApiSweepTrigger`), the P6-OBS-01 shape.
    for (const [eventName, schema] of Object.entries(CARE_LOOP_ANALYTICS_EVENTS)) {
      if (eventName.endsWith('_sweep_completed')) {
        expect(schema.emitter, eventName).toBe('verdery-workers');
      } else {
        expect(schema.emitter, eventName).toBe('verdery-api');
      }
    }
  });
});
