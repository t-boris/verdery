/**
 * Kysely adapter for `WeatherRefreshCandidateSource` — see the port's own
 * header comment for the selection and ordering semantics, and for why this
 * cross-schema read lives here.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { WeatherRefreshCandidateSource } from '../application/weather-refresh-candidate-source.js';

export class KyselyWeatherRefreshCandidateSource implements WeatherRefreshCandidateSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listRefreshCandidates(limit: number): Promise<readonly Uuid[]> {
    const rows = await this.db
      .selectFrom('gardens_mapping.garden as garden')
      .innerJoin('gardens_mapping.georeference as georeference', (join) =>
        join
          .onRef('georeference.garden_id', '=', 'garden.id')
          .on('georeference.valid_until', 'is', null),
      )
      .leftJoin(
        // Latest OBSERVATION fetch per garden — the same read
        // `RefreshGardenWeather`'s cache decision starts from, aggregated.
        (eb) =>
          eb
            .selectFrom('integrations.weather_record as weather')
            .where('weather.record_kind', '=', 'observation')
            .groupBy('weather.garden_id')
            .select('weather.garden_id')
            .select((inner) => inner.fn.max('weather.fetched_at').as('latest_fetched_at'))
            .as('latest_weather'),
        (join) => join.onRef('latest_weather.garden_id', '=', 'garden.id'),
      )
      .select(['garden.id'])
      .where('garden.lifecycle_state', '=', 'active')
      .orderBy('latest_weather.latest_fetched_at', (ob) => ob.asc().nullsFirst())
      .orderBy('garden.id', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => row.id);
  }
}
