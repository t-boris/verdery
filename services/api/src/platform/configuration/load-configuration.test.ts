import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './load-configuration.js';

const VALID_ENVIRONMENT = {
  VERDERY_ENVIRONMENT: 'development',
  DATABASE_URL: 'postgresql://verdery:secret-value@localhost:5432/verdery',
} as const;

describe('loadConfiguration', () => {
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
});
