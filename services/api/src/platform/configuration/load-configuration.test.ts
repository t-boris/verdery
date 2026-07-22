import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfiguration } from './load-configuration.js';

const VALID_ENVIRONMENT = {
  VERDERY_ENVIRONMENT: 'development',
  DATABASE_URL: 'postgresql://verdery:secret-value@localhost:5432/verdery',
  FIREBASE_PROJECT_ID: 'verdery-dev',
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
});
