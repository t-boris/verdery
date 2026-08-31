import { describe, expect, it } from 'vitest';

import {
  celsiusToFahrenheit,
  formatTemperature,
  parseTemperatureUnit,
  temperatureUnitCookie,
} from './temperature-unit';

describe('temperature unit preference', () => {
  it('converts Celsius for display without changing provider data', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(20)).toBe(68);
    expect(formatTemperature(26.4, 'fahrenheit', 'en')).toBe('79.5 °F');
    expect(formatTemperature(26.4, 'celsius', 'en')).toBe('26.4 °C');
  });

  it('restores supported cookie values and defaults safely to Celsius', () => {
    expect(parseTemperatureUnit('fahrenheit')).toBe('fahrenheit');
    expect(parseTemperatureUnit('celsius')).toBe('celsius');
    expect(parseTemperatureUnit('kelvin')).toBe('celsius');
    expect(parseTemperatureUnit(undefined)).toBe('celsius');
  });

  it('builds a one-year first-party cookie rather than local-storage state', () => {
    expect(temperatureUnitCookie('fahrenheit')).toContain('verdery_temperature_unit=fahrenheit');
    expect(temperatureUnitCookie('fahrenheit')).toContain('Path=/');
    expect(temperatureUnitCookie('fahrenheit')).toContain('SameSite=Lax');
    expect(temperatureUnitCookie('fahrenheit')).toContain('Max-Age=31536000');
  });
});
