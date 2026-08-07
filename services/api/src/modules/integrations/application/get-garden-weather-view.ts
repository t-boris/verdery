/**
 * The garden's stored weather as a client resource — the first user-facing
 * surface this module's weather half has ever had.
 *
 * `GetGardenWeather` (the read this composes) documents its own deliberate
 * lack of authorization: "no user-facing transport exposes weather this
 * phase — the stage that first exposes weather to an actor adds
 * authorization with its surface." This IS that stage, and this is that
 * authorization: ordinary `viewGarden`, because weather is garden context
 * and anyone who may read the garden may read the conditions over it.
 *
 * NEVER CALLS A PROVIDER, by construction: it composes `GetGardenWeather`,
 * which is itself read-only, so this operation spends no quota, cannot fail
 * because a provider is down, and has no latency coupling to a third party.
 * Refreshing stays exclusively `RefreshGardenWeather`'s job on the
 * scheduled sweep. A person opening a garden must not be able to trigger
 * provider spend by reloading.
 *
 * WHY THE UNAVAILABLE REASON IS COMPUTED HERE RATHER THAN INFERRED BY A
 * CLIENT: "no reading" has three genuinely different causes with three
 * different answers, and only the server can tell them apart —
 * `noProviderConfigured` is a deployment fact nobody using the app can act
 * on, `gardenNotGeoreferenced` is the one a person resolves themselves by
 * setting the garden's location, and `notYetFetched` resolves on its own at
 * the next sweep. Collapsing them into an empty response would leave a
 * client guessing, and the likeliest guess ("something is broken") is wrong
 * in all three cases.
 *
 * The reason is computed in that order deliberately: a missing provider
 * makes the georeference irrelevant, so reporting "set your location" to
 * someone whose environment could never fetch anything would be advice that
 * cannot work.
 *
 * ATTRIBUTION comes off the RECORD, not the registry: every stored record
 * snapshots the licence and attribution of the adapter that produced it
 * ("Provider content retains source and license metadata"), so switching
 * providers never re-attributes rows an earlier provider fetched. The
 * observation is preferred as the attribution source simply because it is
 * the reading a client leads with; the forecast supplies it when only a
 * forecast exists.
 *
 * Source: architecture/external-integrations.md, sections "5. Weather" and
 * "16. Licensing"; architecture/recommendations-and-ai.md, section
 * "4. Structured Inputs"; packages/api-contracts/openapi.yaml, operation
 * `getGardenWeather`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization, GeoreferenceReader } from '../../gardens-mapping/public.js';
import type { WeatherFreshness } from '../domain/weather-freshness.js';
import type { WeatherRecord } from '../domain/weather-record.js';
import type { PrecipitationEntry } from './weather-record-repository.js';
import type { GetGardenPrecipitation } from './get-garden-precipitation.js';
import type { GetGardenWeather } from './get-garden-weather.js';

/** Why no reading is available. `null` whenever at least one reading is present. */
export type GardenWeatherUnavailableReason =
  'noProviderConfigured' | 'gardenNotGeoreferenced' | 'notYetFetched';

export interface GardenWeatherReadingResource {
  readonly effectiveAt: string;
  readonly retrievedAt: string;
  readonly freshness: WeatherFreshness;
  readonly temperatureCelsius: number | null;
  readonly precipitationMm: number | null;
  readonly windSpeedMps: number | null;
  readonly humidityPercent: number | null;
}

/** One elapsed day's rainfall total, as the provider reported it. */
export interface DailyRainfallResource {
  readonly date: string;
  readonly precipitationMm: number;
}

/** The elapsed rainfall series the watering rule accumulates over — see `GardenWeatherResource.recentRainfall`. */
export interface RecentRainfallResource {
  readonly windowDays: number;
  readonly totalMm: number;
  /** Mutable array, matching the generated contract type exactly — the resource is what goes on the wire, not an internal value. */
  readonly days: DailyRainfallResource[];
}

export interface GardenWeatherResource {
  readonly observation: GardenWeatherReadingResource | null;
  readonly forecast: GardenWeatherReadingResource | null;
  readonly providerConfigured: boolean;
  readonly attributionText: string | null;
  readonly unavailableReason: GardenWeatherUnavailableReason | null;
  /**
   * The same elapsed daily series `watering.dry-spell-check` decides on, so
   * a person can see the evidence behind a watering recommendation rather
   * than take it on trust — and see, on a day with no recommendation, that
   * it rained.
   *
   * `null` when nothing was measured. That is deliberately not an empty
   * series: unknown rainfall and zero rainfall lead to opposite decisions.
   */
  readonly recentRainfall: RecentRainfallResource | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the displayed rainfall series reaches. Matches the window
 * `watering.dry-spell-check` accumulates over, so the chart a person reads
 * is the evidence the rule decided on rather than a differently-shaped view
 * of it.
 */
const RAINFALL_WINDOW_DAYS = 7;

/** Whole days: the only non-overlapping complete series a provider reports. */
const DAILY_ACCUMULATION_INTERVAL_SECONDS = 24 * 60 * 60;

/** `null` for an empty series — unknown rainfall, which is not the same claim as no rainfall. */
function toRecentRainfall(entries: readonly PrecipitationEntry[]): RecentRainfallResource | null {
  if (entries.length === 0) {
    return null;
  }
  const days = entries.map((entry) => ({
    // The calendar day the total covers, taken from the stored effective
    // time rather than re-projected through a zone the server does not know.
    date: entry.effectiveAt.toISOString().slice(0, 10),
    precipitationMm: entry.precipitationMm,
  }));
  const totalMm = days.reduce((sum, day) => sum + day.precipitationMm, 0);
  return {
    windowDays: RAINFALL_WINDOW_DAYS,
    // Rounded to a tenth of a millimetre: summing floating-point provider
    // values otherwise produces figures like 4.300000000000001 on screen.
    totalMm: Math.round(totalMm * 10) / 10,
    days,
  };
}

function toReadingResource(
  record: WeatherRecord,
  freshness: WeatherFreshness,
): GardenWeatherReadingResource {
  return {
    effectiveAt: record.effectiveAt.toISOString(),
    retrievedAt: record.fetchedAt.toISOString(),
    freshness,
    temperatureCelsius: record.measurements.temperatureCelsius,
    precipitationMm: record.measurements.precipitationMm,
    windSpeedMps: record.measurements.windSpeedMps,
    humidityPercent: record.measurements.humidityPercent,
  };
}

export class GetGardenWeatherView {
  constructor(
    private readonly getGardenWeather: GetGardenWeather,
    /** The elapsed rainfall series — the evidence behind a watering recommendation, shown rather than asserted. */
    private readonly getGardenPrecipitation: GetGardenPrecipitation,
    private readonly authorization: GardenAuthorization,
    private readonly georeferences: GeoreferenceReader,
    /** `null` when this environment names no active weather provider — the `WEATHER_ACTIVE_PROVIDER_KEY` posture, passed in rather than re-read here. */
    private readonly activeProviderKey: string | null,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenWeatherResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const since = new Date(this.clock.now().getTime() - RAINFALL_WINDOW_DAYS * DAY_MS);
    const [observationResult, forecastResult, rainfallEntries] = await Promise.all([
      this.getGardenWeather.execute({ gardenId, kind: 'observation' }),
      this.getGardenWeather.execute({ gardenId, kind: 'forecast' }),
      this.getGardenPrecipitation.execute({
        gardenId,
        since,
        intervalSeconds: DAILY_ACCUMULATION_INTERVAL_SECONDS,
      }),
    ]);
    const recentRainfall = toRecentRainfall(rainfallEntries);

    const observation =
      observationResult.outcome === 'available'
        ? toReadingResource(observationResult.record, observationResult.freshness)
        : null;
    const forecast =
      forecastResult.outcome === 'available'
        ? toReadingResource(forecastResult.record, forecastResult.freshness)
        : null;

    const providerConfigured = this.activeProviderKey !== null;

    if (observation !== null || forecast !== null) {
      const attributionText =
        observationResult.outcome === 'available'
          ? observationResult.record.attributionText
          : forecastResult.outcome === 'available'
            ? forecastResult.record.attributionText
            : null;
      return {
        observation,
        forecast,
        providerConfigured,
        attributionText,
        unavailableReason: null,
        recentRainfall,
      };
    }

    return {
      observation: null,
      forecast: null,
      providerConfigured,
      attributionText: null,
      unavailableReason: await this.resolveUnavailableReason(gardenId, providerConfigured),
      recentRainfall,
    };
  }

  /** See this file's header for why the order is provider-first: coordinates cannot help an environment that can fetch nothing. */
  private async resolveUnavailableReason(
    gardenId: Uuid,
    providerConfigured: boolean,
  ): Promise<GardenWeatherUnavailableReason> {
    if (!providerConfigured) {
      return 'noProviderConfigured';
    }
    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    return georeference === null ? 'gardenNotGeoreferenced' : 'notYetFetched';
  }
}
