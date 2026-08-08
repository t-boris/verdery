/**
 * Port to this module's own `integrations.weather_record` storage. Follows
 * the established port-plus-adapter-plus-fake convention (see
 * `media/application/media-storage-gateway.ts` for the pattern note) — the
 * real adapter is `persistence/kysely-weather-record-repository.ts`; unit
 * tests use `integrations-test-doubles.ts`'s in-memory fake.
 *
 * Deliberately minimal: exactly the two operations this stage's use cases
 * perform. Rows are append-only (a fetch result is a historical fact), so
 * no update or delete exists.
 *
 * Source: migrations/1785700000000_integrations-weather-baseline.sql.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { WeatherRecord, WeatherRecordKind } from '../domain/weather-record.js';

export interface WeatherRecordRepository {
  /** Persists one fetch's records atomically — a fetch that produced several readings lands whole or not at all. */
  insertMany(records: readonly WeatherRecord[]): Promise<void>;

  /**
   * The most recently FETCHED record of `kind` for `gardenId`, or `null`
   * when none exists. Retrieval order, not effective order: this read
   * serves the cache decision and the freshness classification, both of
   * which are about what this system most recently learned.
   */
  findLatest(gardenId: Uuid, kind: WeatherRecordKind): Promise<WeatherRecord | null>;

  /**
   * The observation describing the most recent ELAPSED MOMENT, or `null`
   * when none exists. Effective order, not retrieval order — the opposite of
   * `findLatest` above, and the reason both exist.
   *
   * WHY THIS IS A SEPARATE READ. One provider response contains two shapes
   * of observation: a point reading (temperature, humidity, wind, and the
   * last hour's rain) and one total per elapsed day (rain only). Both are
   * stored with `record_kind = 'observation'` — the domain's two-value kind
   * cannot express "point reading" versus "daily accumulation", as
   * `open-meteo-payload.ts`'s own header notes.
   *
   * They also arrive in ONE batch, so they share `fetched_at` and
   * `created_at` exactly. `findLatest`'s retrieval ordering therefore fell
   * through to its last tie-break, `id DESC`, and UUIDv7 ids increase in the
   * order the readings were built — point reading first, daily totals after.
   * The largest id was always the last daily row, so "the latest
   * observation" resolved to a rainfall total, and a person was shown
   * `temperature: null`, `humidity: null`, `windSpeed: null` while the point
   * reading sat in the same batch, unread.
   *
   * Ordering by effective time fixes it without a new column: every stored
   * observation is elapsed by construction (`readCurrent` drops a reading
   * dated after `now`), the point reading's effective time is the current
   * period, and every daily total is dated at a midnight already past. The
   * retrieval-order tie-breaks are kept after it, so two fetches of the SAME
   * moment still resolve to the most recently fetched one.
   */
  findLatestObservation(gardenId: Uuid): Promise<WeatherRecord | null>;

  /**
   * The forecast about the NEAREST UPCOMING moment, or the most recent past
   * one when every stored forecast has been overtaken — `null` only when none
   * exists at all.
   *
   * The mirror of `findLatestObservation`, for the same reason and with the
   * direction reversed: a forecast batch holds an hourly point reading for the
   * next hour and one rain-only total per remaining day, so retrieval order
   * resolved to whichever row happened to hold the largest id — the FURTHEST
   * day. The deployed panel showed a date six days out, labelled "Forecast",
   * with temperature, wind and humidity all "not reported".
   *
   * The past-forecast fallback is deliberate rather than returning `null`:
   * "stale data is labeled and used only when product rules permit it"
   * (external-integrations.md section 11), and `GetGardenWeather` classifies
   * freshness on whatever this returns. Hiding an overtaken forecast would
   * turn a visibly stale reading into an indistinguishable absence.
   */
  findNextForecast(gardenId: Uuid, now: Date): Promise<WeatherRecord | null>;

  /**
   * Elapsed precipitation totals for one garden, one accumulation interval,
   * effective at or after `since` — oldest first.
   *
   * WHY AN INTERVAL PARAMETER RATHER THAN "ALL PRECIPITATION ROWS": a
   * provider may report the same rainfall over several periods at once
   * (Open-Meteo reports both the preceding hour and each whole day), and
   * adding those together counts the hour twice, once alone and once inside
   * its day. Summing within ONE interval class is the only arithmetic that
   * is correct without knowing which provider produced the rows, so the
   * caller states the class and the port never guesses.
   *
   * Rows with no recorded interval are excluded entirely rather than
   * assumed to match — "missing facts remain missing" applied to a column
   * that is null on every row written before the interval was recorded.
   *
   * `observation` kind only: a forecast total is a prediction, and adding it
   * to elapsed rainfall would claim rain that has not fallen.
   */
  listElapsedPrecipitation(
    gardenId: Uuid,
    intervalSeconds: number,
    since: Date,
  ): Promise<readonly PrecipitationEntry[]>;
}

/** One elapsed accumulation period and what fell during it. */
export interface PrecipitationEntry {
  /** The period this total is for — its start, as the provider stated it. */
  readonly effectiveAt: Date;
  readonly precipitationMm: number;
}
