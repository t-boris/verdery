'use client';

import type {
  GardenWeatherReading,
  GardenWeatherResult,
  RecentRainfall,
} from '@verdery/api-contracts';
import Link from 'next/link';

import { formatCalendarDay, formatInstant, useLocalization } from '@/shared/localization/public';
import type { Locale, Translate } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import styles from './weather-panel.module.css';
import { useGardenWeather } from './queries';

export interface WeatherPanelProps {
  readonly gardenId: string;
}

interface MeasurementSpec {
  readonly labelKey:
    'weather.temperature' | 'weather.precipitation' | 'weather.wind' | 'weather.humidity';
  readonly valueKey:
    | 'weather.temperatureValue'
    | 'weather.precipitationValue'
    | 'weather.windValue'
    | 'weather.humidityValue';
  readonly read: (reading: GardenWeatherReading) => number | null;
}

/**
 * Fixed order, and every measurement is always rendered — including the ones
 * the provider did not report. A grid that silently drops absent fields
 * makes "not reported" indistinguishable from "zero", which for
 * precipitation is the difference between "it did not rain" and "we do not
 * know whether it rained".
 */
const MEASUREMENTS: readonly MeasurementSpec[] = [
  {
    labelKey: 'weather.temperature',
    valueKey: 'weather.temperatureValue',
    read: (reading) => reading.temperatureCelsius,
  },
  {
    labelKey: 'weather.precipitation',
    valueKey: 'weather.precipitationValue',
    read: (reading) => reading.precipitationMm,
  },
  {
    labelKey: 'weather.wind',
    valueKey: 'weather.windValue',
    read: (reading) => reading.windSpeedMps,
  },
  {
    labelKey: 'weather.humidity',
    valueKey: 'weather.humidityValue',
    read: (reading) => reading.humidityPercent,
  },
];

function ReadingGroup({
  reading,
  titleKey,
  timestampKey,
  t,
  locale,
}: {
  readonly reading: GardenWeatherReading;
  readonly titleKey: 'weather.observationLabel' | 'weather.forecastLabel';
  readonly timestampKey: 'weather.measuredAt' | 'weather.forecastFor';
  readonly t: Translate;
  readonly locale: Locale;
}) {
  return (
    <div className={styles['group']}>
      <div className={styles['groupHeader']}>
        <h3 className={styles['groupTitle']}>{t(titleKey)}</h3>
        <span className={styles['timestamp']}>
          {t(timestampKey, { time: formatInstant(reading.effectiveAt, locale) })}
        </span>
        {reading.freshness === 'stale' && <StatusPill tone="neutral" label={t('weather.stale')} />}
      </div>
      <ul className={styles['readings']}>
        {MEASUREMENTS.map((measurement) => {
          const value = measurement.read(reading);
          return (
            <li className={styles['reading']} key={measurement.labelKey}>
              <span className={styles['readingLabel']}>{t(measurement.labelKey)}</span>
              {value === null ? (
                <span className={styles['readingValueMissing']}>
                  {t('weather.measurementMissing')}
                </span>
              ) : (
                <span className={styles['readingValue']}>
                  {t(measurement.valueKey, { value: String(value) })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {reading.freshness === 'stale' && (
        <p className={styles['note']}>{t('weather.staleExplanation')}</p>
      )}
    </div>
  );
}

/**
 * The rainfall series, as CSS bars.
 *
 * Every bar is a list item carrying its own day and depth as TEXT, so the
 * chart IS its accessible table — the markup a screen reader walks is the
 * markup that is drawn, and there is no second view to keep in sync.
 *
 * A dry day still draws a hairline. "Nothing fell" is a measurement, and it
 * must not be indistinguishable from "we have no reading for that day": the
 * two lead to opposite decisions, which is the same distinction the rule
 * itself refuses to blur.
 *
 * Bars are scaled against the window's own tallest day rather than a fixed
 * ceiling, because the question the chart answers is "when did it rain",
 * not "how does this compare with elsewhere". The decision-relevant number
 * — the total — is stated as text above it, where a number belongs.
 */
function RainfallChart({
  rainfall,
  t,
  locale,
}: {
  readonly rainfall: RecentRainfall;
  readonly t: Translate;
  readonly locale: Locale;
}) {
  const peakMm = rainfall.days.reduce((peak, day) => Math.max(peak, day.precipitationMm), 0);

  return (
    <figure className={styles['rainfall']}>
      <figcaption className={styles['rainfallHeadline']}>
        <span className={styles['groupTitle']}>
          {t('weather.rainfallTitle', { days: String(rainfall.windowDays) })}
        </span>
        <span className={styles['rainfallTotal']}>
          {t('weather.rainfallTotal', { total: String(rainfall.totalMm) })}
        </span>
      </figcaption>
      <ul className={styles['rainfallChart']}>
        {rainfall.days.map((day) => {
          const isDry = day.precipitationMm === 0;
          // Peak zero means every day was dry; every bar is then the
          // hairline, which is exactly the right picture.
          const heightPercent = peakMm === 0 ? 0 : (day.precipitationMm / peakMm) * 100;
          return (
            <li className={styles['rainfallDay']} key={day.date}>
              <span
                aria-hidden="true"
                className={`${styles['rainfallBar']} ${isDry ? styles['rainfallBarDry'] : ''}`}
                style={{ height: `${String(heightPercent)}%` }}
              />
              <span className={styles['rainfallDayLabel']}>
                {t('weather.rainfallDayValue', {
                  day: formatCalendarDay(day.date, locale),
                  value: String(day.precipitationMm),
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={styles['note']}>{t('weather.rainfallExplanation')}</p>
    </figure>
  );
}

function UnavailableNotice({
  result,
  gardenId,
  t,
}: {
  readonly result: GardenWeatherResult;
  readonly gardenId: string;
  readonly t: Translate;
}) {
  const reasonKey =
    result.unavailableReason === 'noProviderConfigured'
      ? 'weather.reasonNoProvider'
      : result.unavailableReason === 'gardenNotGeoreferenced'
        ? 'weather.reasonNotGeoreferenced'
        : 'weather.reasonNotYetFetched';

  return (
    <div className={styles['unavailable']}>
      <h3 className={styles['groupTitle']}>{t('weather.unavailableTitle')}</h3>
      <p className={styles['note']}>{t(reasonKey)}</p>
      {/* The one reason a person can resolve — so it is the one that gets a
          way to resolve it. The other two are stated and left alone. */}
      {result.unavailableReason === 'gardenNotGeoreferenced' && (
        <Link href={`/application/gardens/${gardenId}`}>{t('weather.setLocation')}</Link>
      )}
    </div>
  );
}

/**
 * The conditions over a garden, shown next to the recommendations they
 * produced.
 *
 * WHY IT SITS ON THE TODAY PAGE: two of the seven rules read weather, and
 * their explanations quote the exact reading they fired on. Showing the same
 * readings above the list is what makes "check whether this plant needs
 * watering" verifiable rather than a claim — and, on a day with no weather,
 * makes the ABSENCE of those recommendations legible instead of looking like
 * an empty list.
 *
 * Every degraded state is rendered as content, not hidden: a stale reading
 * is labelled and kept (it is still the most recent one this garden has),
 * and each of the three unavailable reasons gets its own sentence because
 * only one of them is something the reader can act on.
 *
 * Attribution is rendered whenever a reading is — a licence obligation of
 * the provider terms carried on the record itself, not a courtesy.
 */
export function WeatherPanel({ gardenId }: WeatherPanelProps) {
  const { t, locale } = useLocalization();
  const query = useGardenWeather(gardenId);

  return (
    <section className={styles['section']} aria-labelledby="weather-panel-title">
      <h2 className={styles['title']} id="weather-panel-title">
        {t('weather.title')}
      </h2>

      {query.isPending && <p role="status">{t('weather.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('weather.retry')}
          </Button>
        </div>
      )}

      {query.data !== undefined && (
        <>
          {query.data.observation !== null && (
            <ReadingGroup
              reading={query.data.observation}
              titleKey="weather.observationLabel"
              timestampKey="weather.measuredAt"
              t={t}
              locale={locale}
            />
          )}
          {query.data.forecast !== null && (
            <ReadingGroup
              reading={query.data.forecast}
              titleKey="weather.forecastLabel"
              timestampKey="weather.forecastFor"
              t={t}
              locale={locale}
            />
          )}
          {query.data.observation === null && query.data.forecast === null && (
            <UnavailableNotice result={query.data} gardenId={gardenId} t={t} />
          )}
          {query.data.recentRainfall === null ? (
            <p className={styles['note']}>{t('weather.rainfallNone')}</p>
          ) : (
            <RainfallChart rainfall={query.data.recentRainfall} t={t} locale={locale} />
          )}
          <p className={styles['note']}>
            {query.data.observation === null && query.data.forecast === null
              ? t('weather.ruleImpactWithoutWeather')
              : t('weather.ruleImpactWithWeather')}
          </p>
          {query.data.attributionText !== null && (
            <p className={styles['attribution']}>{query.data.attributionText}</p>
          )}
        </>
      )}
    </section>
  );
}
