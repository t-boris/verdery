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
}
