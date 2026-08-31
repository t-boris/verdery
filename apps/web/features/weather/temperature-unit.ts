import type { Locale } from '@/shared/localization/public';

export type TemperatureUnit = 'celsius' | 'fahrenheit';

export const TEMPERATURE_UNIT_COOKIE_NAME = 'verdery_temperature_unit';
export const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'celsius';
export const TEMPERATURE_UNIT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseTemperatureUnit(value: string | undefined): TemperatureUnit {
  return value === 'fahrenheit' || value === 'celsius' ? value : DEFAULT_TEMPERATURE_UNIT;
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function formatTemperature(celsius: number, unit: TemperatureUnit, locale: Locale): string {
  const value = unit === 'celsius' ? celsius : celsiusToFahrenheit(celsius);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return `${number} °${unit === 'celsius' ? 'C' : 'F'}`;
}

export function temperatureUnitCookie(unit: TemperatureUnit): string {
  return `${TEMPERATURE_UNIT_COOKIE_NAME}=${unit}; Path=/; Max-Age=${String(
    TEMPERATURE_UNIT_COOKIE_MAX_AGE_SECONDS,
  )}; SameSite=Lax`;
}
