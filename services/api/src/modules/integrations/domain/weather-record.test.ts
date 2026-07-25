import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CreateWeatherRecordInput } from './weather-record.js';
import {
  createWeatherRecord,
  validateWeatherLocation,
  validateWeatherProviderKey,
} from './weather-record.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01';
const RECORD_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c02';
const FETCHED_AT = new Date('2026-07-25T12:00:00Z');

function validInput(overrides: Partial<CreateWeatherRecordInput> = {}): CreateWeatherRecordInput {
  return {
    id: RECORD_ID,
    gardenId: GARDEN_ID,
    rawProviderKey: 'fake-provider-a',
    kind: 'observation',
    effectiveAt: new Date('2026-07-25T11:55:00Z'),
    fetchedAt: FETCHED_AT,
    location: { latitude: 52.1, longitude: 4.3 },
    measurements: {
      temperatureCelsius: 21.4,
      precipitationMm: 0.2,
      windSpeedMps: 3.1,
      humidityPercent: 64,
    },
    sourceUnits: {
      temperature: 'celsius',
      precipitation: 'millimetre',
      windSpeed: 'metre_per_second',
      humidity: 'percent',
    },
    quality: { confidence: 0.9, label: 'good' },
    rawLicenseNote: 'test license: internal use only',
    attributionText: 'Weather by fake-provider-a',
    now: FETCHED_AT,
    ...overrides,
  };
}

describe('createWeatherRecord', () => {
  it('builds a normalized record, trimming free-text fields', () => {
    const record = createWeatherRecord(
      validInput({ rawProviderKey: '  fake-provider-a  ', rawLicenseNote: '  some license  ' }),
    );

    expect(record.providerKey).toBe('fake-provider-a');
    expect(record.licenseNote).toBe('some license');
    expect(record.kind).toBe('observation');
    expect(record.measurements.temperatureCelsius).toBe(21.4);
    expect(record.sourceUnits.temperature).toBe('celsius');
    expect(record.quality).toEqual({ confidence: 0.9, label: 'good' });
    expect(record.createdAt).toBe(FETCHED_AT);
  });

  it('accepts partial measurements: missing facts remain missing, with provenance nulled to match', () => {
    const record = createWeatherRecord(
      validInput({
        measurements: {
          temperatureCelsius: 18,
          precipitationMm: null,
          windSpeedMps: null,
          humidityPercent: null,
        },
        sourceUnits: {
          temperature: 'fahrenheit',
          precipitation: null,
          windSpeed: null,
          humidity: null,
        },
      }),
    );
    expect(record.measurements.precipitationMm).toBeNull();
    expect(record.sourceUnits.temperature).toBe('fahrenheit');
  });

  it('rejects a record with no measurement at all', () => {
    expect(() =>
      createWeatherRecord(
        validInput({
          measurements: {
            temperatureCelsius: null,
            precipitationMm: null,
            windSpeedMps: null,
            humidityPercent: null,
          },
          sourceUnits: { temperature: null, precipitation: null, windSpeed: null, humidity: null },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('rejects a present measurement without its source unit, and a unit without its measurement', () => {
    expect(() =>
      createWeatherRecord(
        validInput({
          sourceUnits: {
            temperature: null,
            precipitation: 'millimetre',
            windSpeed: 'metre_per_second',
            humidity: 'percent',
          },
        }),
      ),
    ).toThrow(ValidationError);

    expect(() =>
      createWeatherRecord(
        validInput({
          measurements: {
            temperatureCelsius: 18,
            precipitationMm: null,
            windSpeedMps: null,
            humidityPercent: null,
          },
          sourceUnits: {
            temperature: 'celsius',
            precipitation: 'millimetre',
            windSpeed: null,
            humidity: null,
          },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('rejects out-of-range and non-finite measurements', () => {
    const cases: Partial<CreateWeatherRecordInput>[] = [
      { measurements: { ...validInput().measurements, precipitationMm: -1 } },
      { measurements: { ...validInput().measurements, windSpeedMps: -0.1 } },
      { measurements: { ...validInput().measurements, humidityPercent: 101 } },
      { measurements: { ...validInput().measurements, temperatureCelsius: Number.NaN } },
    ];
    for (const overrides of cases) {
      expect(() => createWeatherRecord(validInput(overrides))).toThrow(ValidationError);
    }
  });

  it('rejects an observation whose effective time is after its fetch time, but accepts it for a forecast', () => {
    const future = new Date('2026-07-25T15:00:00Z');
    expect(() => createWeatherRecord(validInput({ effectiveAt: future }))).toThrow(ValidationError);
    const forecast = createWeatherRecord(validInput({ kind: 'forecast', effectiveAt: future }));
    expect(forecast.kind).toBe('forecast');
  });

  it('rejects blank provider key, blank license, blank attribution, and out-of-range confidence', () => {
    expect(() => createWeatherRecord(validInput({ rawProviderKey: '   ' }))).toThrow(
      ValidationError,
    );
    expect(() => createWeatherRecord(validInput({ rawLicenseNote: ' ' }))).toThrow(ValidationError);
    expect(() => createWeatherRecord(validInput({ attributionText: '  ' }))).toThrow(
      ValidationError,
    );
    expect(() =>
      createWeatherRecord(validInput({ quality: { confidence: 1.5, label: null } })),
    ).toThrow(ValidationError);
    expect(() =>
      createWeatherRecord(validInput({ quality: { confidence: null, label: '  ' } })),
    ).toThrow(ValidationError);
  });
});

describe('validateWeatherLocation', () => {
  it('accepts the WGS84 corner values and rejects beyond them', () => {
    expect(validateWeatherLocation({ latitude: -90, longitude: 180 })).toEqual({
      latitude: -90,
      longitude: 180,
    });
    expect(() => validateWeatherLocation({ latitude: 90.01, longitude: 0 })).toThrow(
      ValidationError,
    );
    expect(() => validateWeatherLocation({ latitude: 0, longitude: -180.01 })).toThrow(
      ValidationError,
    );
    expect(() => validateWeatherLocation({ latitude: Number.NaN, longitude: 0 })).toThrow(
      ValidationError,
    );
  });
});

describe('validateWeatherProviderKey', () => {
  it('trims and rejects blank', () => {
    expect(validateWeatherProviderKey(' fake ')).toBe('fake');
    expect(() => validateWeatherProviderKey('')).toThrow(ValidationError);
  });
});
