'use client';

import type {
  GardenWeatherReading,
  GardenWeatherResult,
  RecentRainfall,
} from '@verdery/api-contracts';
import Link from 'next/link';
import { useState, type ComponentType } from 'react';

import { formatCalendarDay, formatInstant, useLocalization } from '@/shared/localization/public';
import type { Locale, Translate } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill, SunIcon } from '@/shared/ui/public';

import styles from './weather-panel.module.css';
import { useGardenWeather } from './queries';
import { formatTemperature, temperatureUnitCookie, type TemperatureUnit } from './temperature-unit';
import { HumidityIcon, RainIcon, TemperatureIcon, WindIcon } from './weather-icons';

export interface WeatherPanelProps {
  readonly gardenId: string;
  readonly initialTemperatureUnit: TemperatureUnit;
}

interface MeasurementSpec {
  readonly kind: 'temperature' | 'precipitation' | 'wind' | 'humidity';
  readonly labelKey:
    'weather.temperature' | 'weather.precipitation' | 'weather.wind' | 'weather.humidity';
  readonly valueKey:
    'weather.precipitationValue' | 'weather.windValue' | 'weather.humidityValue' | null;
  readonly read: (reading: GardenWeatherReading) => number | null;
  readonly icon: ComponentType;
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
    kind: 'temperature',
    labelKey: 'weather.temperature',
    valueKey: null,
    read: (reading) => reading.temperatureCelsius,
    icon: TemperatureIcon,
  },
  {
    kind: 'precipitation',
    labelKey: 'weather.precipitation',
    valueKey: 'weather.precipitationValue',
    read: (reading) => reading.precipitationMm,
    icon: RainIcon,
  },
  {
    kind: 'wind',
    labelKey: 'weather.wind',
    valueKey: 'weather.windValue',
    read: (reading) => reading.windSpeedMps,
    icon: WindIcon,
  },
  {
    kind: 'humidity',
    labelKey: 'weather.humidity',
    valueKey: 'weather.humidityValue',
    read: (reading) => reading.humidityPercent,
    icon: HumidityIcon,
  },
];

function ReadingGroup({
  reading,
  titleKey,
  timestampKey,
  t,
  locale,
  temperatureUnit,
}: {
  readonly reading: GardenWeatherReading;
  readonly titleKey: 'weather.observationLabel' | 'weather.forecastLabel';
  readonly timestampKey: 'weather.measuredAt' | 'weather.forecastFor';
  readonly t: Translate;
  readonly locale: Locale;
  readonly temperatureUnit: TemperatureUnit;
}) {
  return (
    <div className={styles['group']}>
      <div className={styles['groupHeader']}>
        <div className={styles['groupIdentity']}>
          {titleKey === 'weather.observationLabel' ? <SunIcon /> : <WindIcon />}
          <div>
            <h3 className={styles['groupTitle']}>{t(titleKey)}</h3>
            <p className={styles['windowLabel']}>
              {t(
                titleKey === 'weather.observationLabel'
                  ? 'weather.observationWindow'
                  : 'weather.forecastWindow',
              )}
            </p>
          </div>
        </div>
        {reading.freshness === 'stale' && <StatusPill tone="neutral" label={t('weather.stale')} />}
      </div>
      <p className={styles['timestamp']}>
        {t(timestampKey, { time: formatInstant(reading.effectiveAt, locale) })}
        {' · '}
        {t('weather.fetchedAt', { time: formatInstant(reading.retrievedAt, locale) })}
      </p>
      <ul className={styles['readings']}>
        {MEASUREMENTS.map((measurement) => {
          const value = measurement.read(reading);
          const Icon = measurement.icon;
          return (
            <li className={styles['reading']} key={measurement.labelKey}>
              <span className={styles['readingLabel']}>
                <Icon />
                {t(measurement.labelKey)}
              </span>
              {value === null ? (
                <span className={styles['readingValueMissing']}>
                  {t('weather.measurementMissing')}
                </span>
              ) : (
                <span className={styles['readingValue']}>
                  {measurement.valueKey === null
                    ? formatTemperature(value, temperatureUnit, locale)
                    : t(measurement.valueKey, { value: String(value) })}
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

function TodayPrecipitation({
  observation,
  t,
}: {
  readonly observation: GardenWeatherReading | null;
  readonly t: Translate;
}) {
  const latest = observation?.precipitationMm ?? null;
  return (
    <div className={styles['todayPrecipitation']}>
      <div className={styles['groupIdentity']}>
        <RainIcon />
        <h3 className={styles['groupTitle']}>{t('weather.todayPrecipitationTitle')}</h3>
      </div>
      {latest === null ? (
        <p className={styles['readingValueMissing']}>
          {t('weather.todayPrecipitationUnavailable')}
        </p>
      ) : (
        <p className={styles['todayPrecipitationValue']}>
          {t('weather.latestIntervalPrecipitation', { value: String(latest) })}
        </p>
      )}
      <p className={styles['note']}>{t('weather.todayPrecipitationExplanation')}</p>
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
        <span className={styles['groupIdentity']}>
          <RainIcon />
          <span className={styles['groupTitle']}>
            {t('weather.rainfallTitle', { days: String(rainfall.windowDays) })}
          </span>
        </span>
        <span className={styles['rainfallTotal']}>
          {t('weather.rainfallTotal', { total: String(rainfall.totalMm) })}
        </span>
      </figcaption>
      <p className={styles['windowLabel']}>
        {t('weather.rainfallCoverage', {
          available: String(rainfall.days.length),
          days: String(rainfall.windowDays),
        })}
      </p>
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
export function WeatherPanel({ gardenId, initialTemperatureUnit }: WeatherPanelProps) {
  const { t, locale } = useLocalization();
  const query = useGardenWeather(gardenId);
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(initialTemperatureUnit);

  const chooseTemperatureUnit = (unit: TemperatureUnit) => {
    setTemperatureUnit(unit);
    document.cookie = temperatureUnitCookie(unit);
  };

  return (
    <section className={styles['section']} aria-labelledby="weather-panel-title">
      <div className={styles['sectionHeader']}>
        <div>
          <h2 className={styles['title']} id="weather-panel-title">
            {t('weather.title')}
          </h2>
          <p className={styles['sectionDescription']}>{t('weather.description')}</p>
        </div>
        <div
          className={styles['unitSwitch']}
          role="group"
          aria-label={t('weather.temperatureUnit')}
        >
          {(['celsius', 'fahrenheit'] as const).map((unit) => (
            <button
              type="button"
              key={unit}
              aria-pressed={temperatureUnit === unit}
              onClick={() => chooseTemperatureUnit(unit)}
            >
              {unit === 'celsius' ? '°C' : '°F'}
            </button>
          ))}
        </div>
      </div>

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
          <div className={styles['conditionsGrid']}>
            {query.data.observation !== null && (
              <ReadingGroup
                reading={query.data.observation}
                titleKey="weather.observationLabel"
                timestampKey="weather.measuredAt"
                t={t}
                locale={locale}
                temperatureUnit={temperatureUnit}
              />
            )}
            {query.data.forecast !== null && (
              <ReadingGroup
                reading={query.data.forecast}
                titleKey="weather.forecastLabel"
                timestampKey="weather.forecastFor"
                t={t}
                locale={locale}
                temperatureUnit={temperatureUnit}
              />
            )}
          </div>
          {query.data.observation === null && query.data.forecast === null && (
            <UnavailableNotice result={query.data} gardenId={gardenId} t={t} />
          )}
          <TodayPrecipitation observation={query.data.observation} t={t} />
          {query.data.recentRainfall === null ? (
            <p className={styles['note']}>{t('weather.rainfallNone')}</p>
          ) : (
            <RainfallChart rainfall={query.data.recentRainfall} t={t} locale={locale} />
          )}
          <div className={styles['impact']}>
            <h3 className={styles['groupTitle']}>{t('weather.ruleImpactTitle')}</h3>
            <p className={styles['note']}>
              {query.data.observation === null && query.data.forecast === null
                ? t('weather.ruleImpactWithoutWeather')
                : t('weather.ruleImpactWithWeather')}
            </p>
          </div>
          {query.data.attributionText !== null && (
            <p className={styles['attribution']}>{query.data.attributionText}</p>
          )}
        </>
      )}
    </section>
  );
}
