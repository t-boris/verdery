import type { GardenWeatherReading, GardenWeatherResult } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { useGardenWeather } from './queries';
import { WeatherPanel } from './weather-panel';

vi.mock('./queries', () => ({ useGardenWeather: vi.fn() }));

const mockedUseWeather = vi.mocked(useGardenWeather);

/**
 * Only the fields `weather-panel.tsx` actually reads are supplied — this is
 * not a real `UseQueryResult`, so the loosely-typed literal is cast through
 * `unknown` once, in this one helper. Mirrors `today-list.test.tsx`.
 */
function mockWeather(fields: Record<string, unknown>): void {
  mockedUseWeather.mockReturnValue(fields as unknown as ReturnType<typeof useGardenWeather>);
}

const ATTRIBUTION = 'Weather data by Open-Meteo.com (https://open-meteo.com), CC BY 4.0';

function reading(overrides: Partial<GardenWeatherReading> = {}): GardenWeatherReading {
  return {
    effectiveAt: '2026-08-07T09:00:00.000Z',
    retrievedAt: '2026-08-07T09:05:00.000Z',
    freshness: 'fresh',
    temperatureCelsius: 26.4,
    precipitationMm: 0,
    windSpeedMps: 3.1,
    humidityPercent: 48,
    ...overrides,
  };
}

function result(overrides: Partial<GardenWeatherResult> = {}): GardenWeatherResult {
  return {
    observation: reading(),
    forecast: null,
    providerConfigured: true,
    attributionText: ATTRIBUTION,
    unavailableReason: null,
    recentRainfall: {
      windowDays: 7,
      totalMm: 3.3,
      days: [
        { date: '2026-08-04', precipitationMm: 0 },
        { date: '2026-08-05', precipitationMm: 3.3 },
        { date: '2026-08-06', precipitationMm: 0 },
      ],
    },
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <WeatherPanel gardenId="019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01" />
    </LocalizationProvider>,
  );
}

describe('WeatherPanel', () => {
  it('renders every measurement and the provider attribution the licence requires', () => {
    mockWeather({ data: result(), isPending: false, isLoadingError: false });

    renderPanel();

    expect(screen.getByText('26.4 °C')).toBeTruthy();
    expect(screen.getByText('3.1 m/s')).toBeTruthy();
    expect(screen.getByText('48%')).toBeTruthy();
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
  });

  it('distinguishes an unreported measurement from a zero one', () => {
    mockWeather({
      data: result({ observation: reading({ precipitationMm: null }) }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    // Zero rainfall and unknown rainfall must not render the same, because
    // "it did not rain" and "we do not know" lead to opposite decisions.
    expect(screen.getByText('Not reported')).toBeTruthy();
    expect(screen.queryByText('0 mm')).toBeNull();
  });

  it('keeps a stale reading visible and labelled rather than hiding it', () => {
    mockWeather({
      data: result({ observation: reading({ freshness: 'stale' }) }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByText('Out of date')).toBeTruthy();
    expect(screen.getByText('26.4 °C')).toBeTruthy();
  });

  it('offers a way to fix the one unavailable reason a person can fix', () => {
    mockWeather({
      data: result({
        observation: null,
        attributionText: null,
        unavailableReason: 'gardenNotGeoreferenced',
      }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByRole('link', { name: 'Set the location' })).toBeTruthy();
  });

  it('offers no action for a reason the reader cannot act on', () => {
    mockWeather({
      data: result({
        observation: null,
        attributionText: null,
        providerConfigured: false,
        unavailableReason: 'noProviderConfigured',
      }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.queryByRole('link', { name: 'Set the location' })).toBeNull();
    expect(screen.getByText(/no weather provider switched on/u)).toBeTruthy();
  });

  it('draws the rainfall series as its own accessible table — every bar carries its day and depth as text', () => {
    mockWeather({ data: result(), isPending: false, isLoadingError: false });

    renderPanel();

    // A dry day is stated, not omitted: "nothing fell" and "no reading"
    // lead to opposite decisions and must not look the same. Each bar is
    // labelled with its own day, which is what makes it readable without
    // the drawing.
    expect(screen.getAllByText(/Aug 4.*0 mm/u)).toHaveLength(1);
    expect(screen.getAllByText(/Aug 5.*3\.3 mm/u)).toHaveLength(1);
  });

  it('says plainly when no rainfall has been measured, rather than drawing an empty chart', () => {
    mockWeather({
      data: result({ recentRainfall: null }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByText(/No rainfall has been measured/u)).toBeTruthy();
  });

  it('explains which recommendations the absence of weather suppresses', () => {
    mockWeather({
      data: result({
        observation: null,
        attributionText: null,
        unavailableReason: 'notYetFetched',
      }),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(
      screen.getByText(/watering checks and frost warnings cannot be generated/u),
    ).toBeTruthy();
  });
});
