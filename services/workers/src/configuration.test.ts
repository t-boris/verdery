import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './configuration.js';
import { createLogger } from './logger.js';

describe('loadConfiguration', () => {
  it('applies documented defaults', () => {
    const configuration = loadConfiguration({ VERDERY_ENVIRONMENT: 'development' });

    expect(configuration).toEqual({
      environment: 'development',
      serviceVersion: '0.0.0-development',
      logLevel: 'info',
    });
  });

  it('names the offending variable when the environment is invalid', () => {
    try {
      loadConfiguration({ VERDERY_ENVIRONMENT: 'nowhere' });
      expect.unreachable('An unknown environment must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toEqual(['VERDERY_ENVIRONMENT']);
    }
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
