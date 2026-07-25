import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './configuration.js';
import { createLogger } from './logger.js';

const VALID_ENVIRONMENT = {
  VERDERY_ENVIRONMENT: 'development',
  DATABASE_URL: 'postgresql://verdery:secret-value@localhost:5432/verdery',
  MEDIA_PROCESSING_QUEUE_PROJECT_ID: 'verdery-dev',
  MEDIA_PROCESSING_QUEUE_LOCATION: 'us-central1',
  MEDIA_PROCESSING_QUEUE_NAME: 'media-processing-dev',
  MEDIA_PROCESSING_TASK_URL: 'https://verdery-worker-dev.example/internal/media-validation-jobs',
  MEDIA_PROCESSING_RESULT_CALLBACK_URL:
    'https://verdery-api-dev.example/v1/internal/media-processing-jobs',
  MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE:
    'https://verdery-api-dev.example/v1/internal/media-processing-jobs',
  MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL:
    'verdery-dev-worker@verdery-dev.iam.gserviceaccount.com',
  MEDIA_DERIVED_BUCKET: 'verdery-dev-derived',
  MEDIA_RETENTION_SWEEP_URL: 'https://verdery-api-dev.example/v1/internal/media-retention/sweep',
  WEATHER_REFRESH_SWEEP_URL: 'https://verdery-api-dev.example/v1/internal/weather-refresh/sweep',
  RECOMMENDATION_EVALUATION_SWEEP_URL:
    'https://verdery-api-dev.example/v1/internal/recommendation-evaluation/sweep',
  NOTIFICATION_EVENTS_URL: 'https://verdery-api-dev.example/v1/internal/notifications/events',
  NOTIFICATION_DELIVERY_SWEEP_URL:
    'https://verdery-api-dev.example/v1/internal/notification-delivery/sweep',
  EXPORT_PROCESSING_API_URL: 'https://verdery-api-dev.example/v1/internal/exports',
} as const;

describe('loadConfiguration', () => {
  it('applies documented defaults to optional variables', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration).toEqual({
      environment: 'development',
      serviceVersion: '0.0.0-development',
      logLevel: 'info',
      httpPort: 8080,
      database: {
        url: VALID_ENVIRONMENT.DATABASE_URL,
        maxConnections: 5,
        connectionTimeoutMs: 5_000,
        statementTimeoutMs: 10_000,
      },
      relay: { pollIntervalMs: 5_000, batchSize: 20 },
      mediaProcessing: {
        projectId: 'verdery-dev',
        location: 'us-central1',
        queueName: 'media-processing-dev',
        taskUrl: VALID_ENVIRONMENT.MEDIA_PROCESSING_TASK_URL,
        resultCallbackUrl: VALID_ENVIRONMENT.MEDIA_PROCESSING_RESULT_CALLBACK_URL,
        resultCallbackAudience: VALID_ENVIRONMENT.MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE,
        invokerServiceAccountEmail:
          VALID_ENVIRONMENT.MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL,
      },
      mediaDerivedBucket: VALID_ENVIRONMENT.MEDIA_DERIVED_BUCKET,
      retentionSweep: {
        sweepUrl: VALID_ENVIRONMENT.MEDIA_RETENTION_SWEEP_URL,
        intervalMs: 3_600_000,
      },
      weatherRefreshSweep: {
        sweepUrl: VALID_ENVIRONMENT.WEATHER_REFRESH_SWEEP_URL,
        intervalMs: 3_600_000,
      },
      recommendationEvaluationSweep: {
        sweepUrl: VALID_ENVIRONMENT.RECOMMENDATION_EVALUATION_SWEEP_URL,
        intervalMs: 21_600_000,
      },
      notificationEventsUrl: VALID_ENVIRONMENT.NOTIFICATION_EVENTS_URL,
      notificationDeliverySweep: {
        sweepUrl: VALID_ENVIRONMENT.NOTIFICATION_DELIVERY_SWEEP_URL,
        intervalMs: 60_000,
      },
      exportProcessingApiUrl: VALID_ENVIRONMENT.EXPORT_PROCESSING_API_URL,
    });
  });

  it('rejects a missing EXPORT_PROCESSING_API_URL — the export job cannot reach its snapshot endpoints without a target (P8-EXPORT-01)', () => {
    const { EXPORT_PROCESSING_API_URL: _omit, ...withoutExportUrl } = VALID_ENVIRONMENT;
    try {
      loadConfiguration(withoutExportUrl);
      expect.unreachable('A missing EXPORT_PROCESSING_API_URL must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['EXPORT_PROCESSING_API_URL']),
      );
    }
  });

  it('rejects a missing NOTIFICATION_DELIVERY_SWEEP_URL — the delivery sweep fails loudly at configuration load (P7-NOTIF-02)', () => {
    const { NOTIFICATION_DELIVERY_SWEEP_URL: _omit, ...withoutDeliverySweepUrl } =
      VALID_ENVIRONMENT;
    try {
      loadConfiguration(withoutDeliverySweepUrl);
      expect.unreachable('A missing NOTIFICATION_DELIVERY_SWEEP_URL must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['NOTIFICATION_DELIVERY_SWEEP_URL']),
      );
    }
  });

  it('rejects a missing NOTIFICATION_EVENTS_URL — the relay cannot forward notification events without a target (P7-NOTIF-01)', () => {
    const { NOTIFICATION_EVENTS_URL: _omit, ...withoutNotificationEventsUrl } = VALID_ENVIRONMENT;
    try {
      loadConfiguration(withoutNotificationEventsUrl);
      expect.unreachable('A missing NOTIFICATION_EVENTS_URL must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['NOTIFICATION_EVENTS_URL']),
      );
    }
  });

  it('rejects a missing sweep URL — every scheduled sweep fails loudly at configuration load (P7-ASYNC-01)', () => {
    const { WEATHER_REFRESH_SWEEP_URL: _omit, ...withoutWeatherSweepUrl } = VALID_ENVIRONMENT;
    try {
      loadConfiguration(withoutWeatherSweepUrl);
      expect.unreachable('A missing WEATHER_REFRESH_SWEEP_URL must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining(['WEATHER_REFRESH_SWEEP_URL']),
      );
    }
  });

  it('parses numeric relay tuning variables into their typed shape', () => {
    const configuration = loadConfiguration({
      ...VALID_ENVIRONMENT,
      RELAY_POLL_INTERVAL_MS: '2000',
      RELAY_BATCH_SIZE: '50',
    });

    expect(configuration.relay).toEqual({ pollIntervalMs: 2_000, batchSize: 50 });
  });

  it('names the offending variable when the environment is invalid', () => {
    try {
      loadConfiguration({ VERDERY_ENVIRONMENT: 'nowhere' });
      expect.unreachable('An unknown environment must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(
        expect.arrayContaining([
          'VERDERY_ENVIRONMENT',
          'DATABASE_URL',
          'MEDIA_PROCESSING_QUEUE_PROJECT_ID',
        ]),
      );
    }
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...withoutDatabaseUrl } = VALID_ENVIRONMENT;
    expect(() => loadConfiguration(withoutDatabaseUrl)).toThrowError(ConfigurationError);
  });
});

describe('createLogger', () => {
  it('emits structured records identifying the service, version, and environment', () => {
    const records: string[] = [];
    const logger = createLogger(
      { environment: 'staging', serviceVersion: '2.0.0', logLevel: 'info' },
      { write: (record) => records.push(record) },
    );

    logger.info({ event: 'service.started' }, 'Worker started');

    expect(JSON.parse(records[0] ?? '{}')).toMatchObject({
      service: 'verdery-workers',
      version: '2.0.0',
      environment: 'staging',
      event: 'service.started',
      severity: 'INFO',
    });
  });

  it('removes secret-bearing fields before a record is written', () => {
    const records: string[] = [];
    const logger = createLogger(
      { environment: 'development', serviceVersion: '1.0.0', logLevel: 'info' },
      { write: (record) => records.push(record) },
    );

    logger.info({ token: 'firebase-id-token', event: 'job.accepted' }, 'Job accepted');

    expect(records[0]).not.toContain('firebase-id-token');
  });
});
