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
import type { GardenAuthorization, GeoreferenceReader } from '../../gardens-mapping/public.js';
import type { WeatherFreshness } from '../domain/weather-freshness.js';
import type { WeatherRecord } from '../domain/weather-record.js';
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

export interface GardenWeatherResource {
  readonly observation: GardenWeatherReadingResource | null;
  readonly forecast: GardenWeatherReadingResource | null;
  readonly providerConfigured: boolean;
  readonly attributionText: string | null;
  readonly unavailableReason: GardenWeatherUnavailableReason | null;
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
    private readonly authorization: GardenAuthorization,
    private readonly georeferences: GeoreferenceReader,
    /** `null` when this environment names no active weather provider — the `WEATHER_ACTIVE_PROVIDER_KEY` posture, passed in rather than re-read here. */
    private readonly activeProviderKey: string | null,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenWeatherResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const [observationResult, forecastResult] = await Promise.all([
      this.getGardenWeather.execute({ gardenId, kind: 'observation' }),
      this.getGardenWeather.execute({ gardenId, kind: 'forecast' }),
    ]);

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
      };
    }

    return {
      observation: null,
      forecast: null,
      providerConfigured,
      attributionText: null,
      unavailableReason: await this.resolveUnavailableReason(gardenId, providerConfigured),
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
