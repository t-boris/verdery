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
