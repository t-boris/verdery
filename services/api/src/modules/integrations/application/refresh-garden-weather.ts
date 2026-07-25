/**
 * Fetches (or honestly declines to fetch) normalized weather for one
 * garden — the single write path into `integrations.weather_record`, built
 * to be called by P7-ASYNC-01's scheduler when it exists and safe to call
 * repeatedly before then: a repeat within the freshness window is a cache
 * hit that never touches the provider.
 *
 * Every way this can fail to produce fresh data is a TYPED, named outcome —
 * the `identifyPlantFromPhoto` honesty posture applied to a whole
 * integration: a missing provider (today's reality — P0-PROV-01 is
 * undecided and NO weather vendor exists in this repository), a garden
 * without a georeference, an exhausted quota, a timeout, a failure, or
 * malformed provider data each degrade to either the latest stored record
 * explicitly LABELED stale ("Cached stale data is labeled and used only
 * when product rules permit it" — external-integrations.md section 11) or
 * an explicit `unavailable`. Never null-as-success, never fabricated data.
 *
 * Order of decisions: cache first (freshness is a property of the stored
 * data, independent of provider state), then location, then provider, then
 * quota — quota is consumed strictly BEFORE the call so concurrent runs
 * cannot overshoot a budget, and a consumed-then-timed-out call stays
 * consumed (the call was made). The provider call happens outside any
 * database transaction (backend-modular-monolith.md section 12).
 *
 * No authorization here: this use case has no user-facing transport — its
 * callers are the scheduler (P7-ASYNC-01) and, indirectly, the rule engine
 * pipeline (P7-RULE-01), both server-owned. The stage that first exposes
 * weather to an actor adds the authorization its surface needs.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "5. Weather", "11. Reliability", "14. Cost and Quota";
 * architecture/backend-modular-monolith.md, section "18. External
 * Providers".
 */

import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GeoreferenceRepository } from '../../gardens-mapping/public.js';
import type { WeatherFreshnessPolicy } from '../domain/weather-freshness.js';
import {
  classifyWeatherFreshness,
  validateWeatherFreshnessPolicy,
} from '../domain/weather-freshness.js';
import type { WeatherLocation, WeatherRecord } from '../domain/weather-record.js';
import { createWeatherRecord } from '../domain/weather-record.js';
import type { ProviderQuotaRepository } from './provider-quota-repository.js';
import type { NormalizedWeatherReading } from './weather-provider.js';
import type {
  WeatherProviderRegistration,
  WeatherProviderRegistry,
} from './weather-provider-registry.js';
import type { WeatherRecordRepository } from './weather-record-repository.js';
import { withDeadline } from './with-deadline.js';

/** Why fresh weather could not be produced. Each value is a distinct, documented degradation the consumer may branch on. */
export type WeatherUnavailableReason =
  | 'noProviderConfigured'
  | 'gardenNotGeoreferenced'
  | 'quotaExhausted'
  | 'providerTimeout'
  | 'providerFailed'
  | 'providerReturnedNoData'
  | 'providerReturnedInvalidData';

export type RefreshGardenWeatherResult =
  /** The stored latest observation is still within its freshness window — served without any provider call. */
  | { readonly outcome: 'freshCacheHit'; readonly record: WeatherRecord }
  /** The provider was called and its readings were persisted. */
  | { readonly outcome: 'refreshed'; readonly records: readonly WeatherRecord[] }
  /** Fresh data could not be produced; the latest stored observation is served, explicitly labeled stale, with the reason. */
  | {
      readonly outcome: 'staleServed';
      readonly record: WeatherRecord;
      readonly reason: WeatherUnavailableReason;
    }
  /** Fresh data could not be produced and nothing is stored to serve. */
  | { readonly outcome: 'unavailable'; readonly reason: WeatherUnavailableReason };

export interface RefreshGardenWeatherInput {
  readonly gardenId: Uuid;
}

/**
 * Environment configuration, per external-integrations.md section 4:
 * "Configuration maps an integration capability to one active adapter per
 * environment." `activeProviderKey: null` is the current, honest reality of
 * every environment — no weather provider has been selected (P0-PROV-01).
 */
export interface RefreshGardenWeatherConfiguration {
  readonly activeProviderKey: string | null;
  readonly freshnessPolicy: WeatherFreshnessPolicy;
}

export class RefreshGardenWeather {
  private readonly configuration: RefreshGardenWeatherConfiguration;

  constructor(
    private readonly registry: WeatherProviderRegistry,
    configuration: RefreshGardenWeatherConfiguration,
    private readonly weatherRecords: WeatherRecordRepository,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly georeferences: GeoreferenceRepository,
    private readonly clock: Clock,
  ) {
    validateWeatherFreshnessPolicy(configuration.freshnessPolicy);
    const key = configuration.activeProviderKey;
    if (key !== null && registry.get(key) === null) {
      // A configured-but-unregistered key is a composition defect, not a
      // runtime degradation — fail at construction, before any garden is
      // silently served "unavailable" for the wrong reason.
      throw new InternalError(
        'integrations.weather.active_provider_not_registered',
        `Active weather provider '${key}' has no registration.`,
      );
    }
    this.configuration = configuration;
  }

  async execute(input: RefreshGardenWeatherInput): Promise<RefreshGardenWeatherResult> {
    const now = this.clock.now();

    const latest = await this.weatherRecords.findLatest(input.gardenId, 'observation');
    if (
      latest !== null &&
      classifyWeatherFreshness(latest, now, this.configuration.freshnessPolicy) === 'fresh'
    ) {
      return { outcome: 'freshCacheHit', record: latest };
    }

    // Past this point `latest` is stale or absent by construction, so every
    // degradation can hand it straight to `degrade` without reclassifying.
    const georeference = await this.georeferences.findCurrentForGarden(input.gardenId);
    if (georeference === null) {
      return degrade(latest, 'gardenNotGeoreferenced');
    }
    // `geographicAnchor` is a GeoJSON WGS84 position: [longitude, latitude].
    const location: WeatherLocation = {
      longitude: georeference.geographicAnchor[0],
      latitude: georeference.geographicAnchor[1],
    };

    if (this.configuration.activeProviderKey === null) {
      return degrade(latest, 'noProviderConfigured');
    }
    const registration = this.registry.get(this.configuration.activeProviderKey);
    if (registration === null) {
      throw new InternalError(
        'integrations.weather.active_provider_not_registered',
        `Active weather provider '${this.configuration.activeProviderKey}' has no registration.`,
      );
    }

    const quota = await this.providerQuotas.consumeCall(
      registration.metadata.providerKey,
      registration.metadata.quotaLimits,
      now,
    );
    if (!quota.consumed) {
      return degrade(latest, 'quotaExhausted');
    }

    let call;
    try {
      call = await withDeadline(registration.metadata.fetchTimeoutMs, (signal) =>
        registration.adapter.fetchWeather(location, signal),
      );
    } catch {
      return degrade(latest, 'providerFailed');
    }
    if (call.kind === 'timedOut') {
      return degrade(latest, 'providerTimeout');
    }
    if (call.value.length === 0) {
      return degrade(latest, 'providerReturnedNoData');
    }

    const fetchedAt = this.clock.now();
    let records: readonly WeatherRecord[];
    try {
      records = call.value.map((reading) =>
        toWeatherRecord(reading, input.gardenId, registration, location, fetchedAt),
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        // Section 15's "malformed response" case: the provider spoke, but
        // not within the normalized contract. Never persisted, never
        // repaired into plausible-looking data.
        return degrade(latest, 'providerReturnedInvalidData');
      }
      throw error;
    }

    await this.weatherRecords.insertMany(records);
    return { outcome: 'refreshed', records };
  }
}

function degrade(
  staleRecord: WeatherRecord | null,
  reason: WeatherUnavailableReason,
): RefreshGardenWeatherResult {
  if (staleRecord !== null) {
    return { outcome: 'staleServed', record: staleRecord, reason };
  }
  return { outcome: 'unavailable', reason };
}

function toWeatherRecord(
  reading: NormalizedWeatherReading,
  gardenId: Uuid,
  registration: WeatherProviderRegistration,
  location: WeatherLocation,
  fetchedAt: Date,
): WeatherRecord {
  return createWeatherRecord({
    id: generateUuidV7(),
    gardenId,
    rawProviderKey: registration.metadata.providerKey,
    kind: reading.kind,
    effectiveAt: reading.effectiveAt,
    fetchedAt,
    location,
    measurements: reading.measurements,
    sourceUnits: reading.sourceUnits,
    quality: reading.quality,
    rawLicenseNote: registration.metadata.licenseNote,
    attributionText: registration.metadata.attributionText,
    now: fetchedAt,
  });
}
