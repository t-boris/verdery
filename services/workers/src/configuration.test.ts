import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './configuration.js';
import { createLogger } from './logger.js';

const VALID_ENVIRONMENT = {
  VERDERY_ENVIRONMENT: 'development',
  DATABASE_URL: 'postgresql://verdery:secret-value@localhost:5432/verdery',
  MEDIA_PROCESSING_QUEUE_PROJECT_ID: 'verdery-dev',
  MEDIA_PROCESSING_QUEUE_LOCATION: 'us-central1',
  MEDIA_PROCESSING_QUEUE_NAME: 'media-processing-dev',
  MEDIA_PROCESSING_CALLBACK_URL:
    'https://verdery-api-dev.example/v1/internal/media-processing-jobs',
  MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL:
    'verdery-dev-worker@verdery-dev.iam.gserviceaccount.com',
} as const;

describe('loadConfiguration', () => {
  it('applies documented defaults to optional variables', () => {
    const configuration = loadConfiguration(VALID_ENVIRONMENT);

    expect(configuration).toEqual({
      environment: 'development',
      serviceVersion: '0.0.0-development',
      logLevel: 'info',
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
        callbackUrl: VALID_ENVIRONMENT.MEDIA_PROCESSING_CALLBACK_URL,
        invokerServiceAccountEmail:
          VALID_ENVIRONMENT.MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL,
      },
    });
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
