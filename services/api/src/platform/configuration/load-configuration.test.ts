import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './load-configuration.js';

const VALID_ENVIRONMENT = {
  VERDERY_ENVIRONMENT: 'development',
  DATABASE_URL: 'postgresql://verdery:secret-value@localhost:5432/verdery',
  FIREBASE_PROJECT_ID: 'verdery-dev',
  MEDIA_USER_MEDIA_BUCKET: 'verdery-dev-user-media',
  MEDIA_RAW_CAPTURE_BUCKET: 'verdery-dev-raw-capture',
  MEDIA_DERIVED_BUCKET: 'verdery-dev-derived',
  MEDIA_EXPORTS_BUCKET: 'verdery-dev-exports',
  MEDIA_PROCESSING_CALLBACK_AUDIENCE:
    'https://verdery-api-dev.example/v1/internal/media-processing-jobs',
  MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL:
    'verdery-dev-worker@verdery-dev.iam.gserviceaccount.com',
} as const;

describe('loadConfiguration', () => {
  it('refuses a signed-access lifetime that is zero or longer than Cloud Storage will sign', () => {
    // T-SIGN-07: an unbounded value turns short-lived signed access into a
    // long-lived bearer credential from one typo. The ceiling is Cloud
    // Storage's own V4 limit, not an invented policy number.
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(() =>
      loadConfiguration({ ...VALID_ENVIRONMENT, MEDIA_SIGNED_DOWNLOAD_TTL_MS: '0' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfiguration({
        ...VALID_ENVIRONMENT,
        MEDIA_SIGNED_DOWNLOAD_TTL_MS: String(sevenDaysMs + 1),
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfiguration({ ...VALID_ENVIRONMENT, MEDIA_UPLOAD_SESSION_TTL_MS: '0' }),
    ).toThrow(ConfigurationError);
    expect(
      loadConfiguration({
        ...VALID_ENVIRONMENT,
        MEDIA_SIGNED_DOWNLOAD_TTL_MS: String(sevenDaysMs),
      }).media.signedDownloadTtlMs,
    ).toBe(sevenDaysMs);
  });

  it('applies documented defaults to optional variables', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration.environment).toBe('development');
    expect(configuration.http.port).toBe(8080);
    expect(configuration.http.allowedOrigins).toEqual([]);
    expect(configuration.logLevel).toBe('info');
    expect(configuration.database.maxConnections).toBe(10);
  });

  it('parses numeric and list variables into their typed shape', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      HTTP_PORT: '9090',
      HTTP_ALLOWED_ORIGINS: 'https://app.example, https://admin.example',
      DATABASE_POOL_MAX_CONNECTIONS: '4',
    });

    expect(configuration.http.port).toBe(9090);
    expect(configuration.http.allowedOrigins).toEqual([
      'https://app.example',
      'https://admin.example',
    ]);
    expect(configuration.database.maxConnections).toBe(4);
  });

  it('names every offending variable when startup configuration is invalid', () => {
    expect(() => loadConfiguration({ HTTP_PORT: 'not-a-port' })).toThrowError(ConfigurationError);

    try {
      loadConfiguration({ HTTP_PORT: 'not-a-port' });
      expect.unreachable('loadConfiguration must reject an invalid environment');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['VERDERY_ENVIRONMENT', 'DATABASE_URL', 'HTTP_PORT']),
      );
    }
  });

  it('never repeats a secret value in the failure message', () => {
    try {
      loadConfiguration({ ...VALID_ENVIRONMENT, DATABASE_URL: '' });
      expect.unreachable('An empty connection string must be rejected');
    } catch (error) {
      const message = (error as ConfigurationError).message;

      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('redacted');
    }
  });

  it('does not leak the connection string of a valid configuration into its own message', () => {
    try {
      loadConfiguration({ ...VALID_ENVIRONMENT, HTTP_PORT: '0' });
      expect.unreachable('Port zero must be rejected');
    } catch (error) {
      expect((error as ConfigurationError).message).not.toContain('secret-value');
    }
  });

  it('parses an explicit weather provider key and freshness overrides', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      WEATHER_ACTIVE_PROVIDER_KEY: 'some-provider',
      WEATHER_OBSERVATION_FRESH_FOR_MS: '600000',
      WEATHER_FORECAST_FRESH_FOR_MS: '7200000',
    });

    expect(configuration.weather).toMatchObject({
      activeProviderKey: 'some-provider',
      observationFreshForMs: 600_000,
      forecastFreshForMs: 7_200_000,
    });
  });

  it('defaults to the "url" connection mode', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);
    expect(configuration.database.mode).toBe('url');
  });

  it('accepts the "cloudSqlIam" mode when its three fields are present and DATABASE_URL is absent', () => {
    const configuration = loadConfiguration({
      VERDERY_ENVIRONMENT: 'production',
      DATABASE_CONNECTION_MODE: 'cloudSqlIam',
      DATABASE_INSTANCE_CONNECTION_NAME: 'verdery-dev:us-central1:verdery-dev-pg',
      DATABASE_IAM_USER: 'verdery-dev-api-runtime@verdery-dev.iam',
      DATABASE_NAME: 'verdery',
      FIREBASE_PROJECT_ID: 'verdery-dev',
      MEDIA_USER_MEDIA_BUCKET: 'verdery-dev-user-media',
      MEDIA_RAW_CAPTURE_BUCKET: 'verdery-dev-raw-capture',
      MEDIA_DERIVED_BUCKET: 'verdery-dev-derived',
      MEDIA_EXPORTS_BUCKET: 'verdery-dev-exports',
      MEDIA_PROCESSING_CALLBACK_AUDIENCE:
        'https://verdery-api-dev.example/v1/internal/media-processing-jobs',
      MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL:
        'verdery-dev-worker@verdery-dev.iam.gserviceaccount.com',
    });

    expect(configuration.database).toEqual(
      expect.objectContaining({
        mode: 'cloudSqlIam',
        instanceConnectionName: 'verdery-dev:us-central1:verdery-dev-pg',
        iamUser: 'verdery-dev-api-runtime@verdery-dev.iam',
        databaseName: 'verdery',
      }),
    );
  });

  it('rejects "cloudSqlIam" mode missing any of its three required fields', () => {
    try {
      loadConfiguration({
        VERDERY_ENVIRONMENT: 'production',
        DATABASE_CONNECTION_MODE: 'cloudSqlIam',
        DATABASE_INSTANCE_CONNECTION_NAME: 'verdery-dev:us-central1:verdery-dev-pg',
        // DATABASE_IAM_USER and DATABASE_NAME deliberately omitted.
      });
      expect.unreachable('cloudSqlIam mode without its required fields must be rejected');
    } catch (error) {
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['DATABASE_IAM_USER', 'DATABASE_NAME']),
      );
    }
  });

  it('rejects "url" mode without DATABASE_URL', () => {
    expect(() =>
      loadConfiguration({ VERDERY_ENVIRONMENT: 'development', DATABASE_CONNECTION_MODE: 'url' }),
    ).toThrowError(ConfigurationError);
  });

  it('defaults the AI-explanation block OFF — the P7-AI-01 kill-switch, the state of every environment', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration.aiExplanation).toEqual({
      enabled: false,
      vertexProjectId: null,
      vertexLocation: 'us-central1',
      model: null,
      callTimeoutMs: 10_000,
      maxOutputTokens: 512,
      maxCallsPerHour: 50,
      maxCallsPerDay: 500,
    });
  });

  it('defaults App Check enforcement OFF — the P8-SEC-02 switch, the state of every environment', () => {
    // The single most load-bearing default in this file. If it ever inverts,
    // every deployed environment starts refusing unattested traffic to the
    // session, media, export, and Today endpoints on the next deploy, with
    // nobody having decided to.
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration.appCheck).toEqual({ enforcement: 'monitor' });
  });

  it('parses the enforce position when it is explicitly asked for', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      APP_CHECK_ENFORCEMENT: 'enforce',
    });

    expect(configuration.appCheck).toEqual({ enforcement: 'enforce' });
  });

  it('rejects an unrecognized App Check enforcement value rather than guessing', () => {
    // A boolean-ish typo like "true" must not silently mean either position.
    // Failing at startup is the only outcome that cannot be misread later.
    expect(() =>
      loadConfiguration({ ...VALID_ENVIRONMENT, APP_CHECK_ENFORCEMENT: 'true' }),
    ).toThrowError(ConfigurationError);
  });

  it('parses an enabled AI-explanation block with its required project and model', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      RECOMMENDATION_AI_EXPLANATION_ENABLED: 'true',
      RECOMMENDATION_AI_VERTEX_PROJECT_ID: 'verdery-dev',
      RECOMMENDATION_AI_MODEL: 'gemini-2.5-flash',
      RECOMMENDATION_AI_CALL_TIMEOUT_MS: '5000',
      RECOMMENDATION_AI_MAX_CALLS_PER_HOUR: '10',
    });

    expect(configuration.aiExplanation).toEqual({
      enabled: true,
      vertexProjectId: 'verdery-dev',
      vertexLocation: 'us-central1',
      model: 'gemini-2.5-flash',
      callTimeoutMs: 5_000,
      maxOutputTokens: 512,
      maxCallsPerHour: 10,
      maxCallsPerDay: 500,
    });
  });

  it('rejects enabling AI explanation without a project id and an explicitly chosen model', () => {
    try {
      loadConfiguration({
        ...VALID_ENVIRONMENT,
        RECOMMENDATION_AI_EXPLANATION_ENABLED: 'true',
      });
      expect.unreachable('Enabling without project and model must be rejected');
    } catch (error) {
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'RECOMMENDATION_AI_MODEL']),
      );
    }
  });

  it('keeps aerial tracing off by default and requires an explicit model when enabled', () => {
    expect(loadConfiguration(VALID_ENVIRONMENT).aerialTraceAi.enabled).toBe(false);

    try {
      loadConfiguration({ ...VALID_ENVIRONMENT, AERIAL_TRACE_AI_ENABLED: 'true' });
      expect.unreachable('Aerial tracing must not guess a Vertex project or model');
    } catch (error) {
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'AERIAL_TRACE_AI_MODEL']),
      );
    }

    expect(
      loadConfiguration({
        ...VALID_ENVIRONMENT,
        AERIAL_TRACE_AI_ENABLED: 'true',
        RECOMMENDATION_AI_VERTEX_PROJECT_ID: 'verdery-dev',
        AERIAL_TRACE_AI_MODEL: 'evaluated-model-id',
      }).aerialTraceAi,
    ).toEqual({
      enabled: true,
      model: 'evaluated-model-id',
      imageryTimeoutMs: 8_000,
      visionTimeoutMs: 20_000,
      maxOutputTokens: 4_096,
      maxCallsPerHour: 10,
      maxCallsPerDay: 30,
    });
  });

  it('defaults the weather block: no active provider, documented freshness windows, keyless non-commercial Open-Meteo', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration.weather).toEqual({
      // P0-PROV-01's weather half is decided, but selecting the adapter is
      // still a per-environment act: unset means `noProviderConfigured`.
      activeProviderKey: null,
      observationFreshForMs: 3_600_000,
      forecastFreshForMs: 21_600_000,
      callTimeoutMs: 8_000,
      maxCallsPerHour: 300,
      maxCallsPerDay: 3_000,
      openMeteo: { tier: 'free', apiKey: null, pastDays: 7, forecastDays: 7 },
    });
  });

  it('parses the paid Open-Meteo tier with its key and day windows', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      WEATHER_ACTIVE_PROVIDER_KEY: 'open-meteo',
      WEATHER_OPEN_METEO_TIER: 'customer',
      WEATHER_OPEN_METEO_API_KEY: 'paid-plan-key',
      WEATHER_OPEN_METEO_PAST_DAYS: '14',
      WEATHER_OPEN_METEO_FORECAST_DAYS: '16',
    });

    expect(configuration.weather.activeProviderKey).toBe('open-meteo');
    expect(configuration.weather.openMeteo).toEqual({
      tier: 'customer',
      apiKey: 'paid-plan-key',
      pastDays: 14,
      forecastDays: 16,
    });
  });

  it('rejects the paid Open-Meteo host without a key, and day windows the API cannot serve', () => {
    try {
      loadConfiguration({ ...VALID_ENVIRONMENT, WEATHER_OPEN_METEO_TIER: 'customer' });
      expect.unreachable('The paid host without a key must be rejected');
    } catch (error) {
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['WEATHER_OPEN_METEO_API_KEY']),
      );
      // The key is a secret: its name may appear, its value never does.
      expect((error as ConfigurationError).message).not.toContain('paid-plan-key');
    }

    expect(() =>
      loadConfiguration({ ...VALID_ENVIRONMENT, WEATHER_OPEN_METEO_FORECAST_DAYS: '30' }),
    ).toThrowError(ConfigurationError);
  });
});
