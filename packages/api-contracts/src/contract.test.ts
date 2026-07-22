import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  API_BASE_PATH,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  SharedErrorCode,
  isApiError,
} from './index.js';

interface ContractDocument {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, { operationId?: string; summary?: string }>>;
  components: {
    schemas: Record<string, unknown>;
    parameters: Record<string, unknown>;
    responses: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
}

const contractPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
const contract = parse(readFileSync(contractPath, 'utf8')) as ContractDocument;

describe('OpenAPI document', () => {
  it('declares OpenAPI 3.1', () => {
    expect(contract.openapi).toBe('3.1.0');
  });

  it('serves the versioned base path the package exports', () => {
    expect(contract.servers.map((server) => server.url)).toContain(API_BASE_PATH);
  });

  it('gives every operation a unique operationId', () => {
    const operationIds: string[] = [];

    for (const operations of Object.values(contract.paths)) {
      for (const operation of Object.values(operations)) {
        if (operation.operationId !== undefined) {
          operationIds.push(operation.operationId);
        }
      }
    }

    expect(operationIds.length).toBeGreaterThan(0);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('defines the idempotency and revision headers the package names', () => {
    const idempotency = contract.components.parameters['IdempotencyKey'] as { name: string };
    const ifMatch = contract.components.parameters['IfMatch'] as { name: string };

    expect(idempotency.name.toLowerCase()).toBe(IDEMPOTENCY_KEY_HEADER);
    expect(ifMatch.name.toLowerCase()).toBe(IF_MATCH_HEADER);
  });

  it('supports both approved authentication flows', () => {
    expect(Object.keys(contract.components.securitySchemes).sort()).toEqual([
      'firebaseIdToken',
      'sessionCookie',
    ]);
  });

  it('defines a geometry envelope that names its coordinate space', () => {
    const envelope = contract.components.schemas['GeometryEnvelope'] as { required: string[] };

    expect(envelope.required).toContain('coordinateSpaceId');
    expect(envelope.required).toContain('coordinateSpaceKind');
    expect(envelope.required).toContain('provenance');
  });

  it('models every status code the error envelope covers', () => {
    for (const name of [
      'BadRequest',
      'Unauthorized',
      'Forbidden',
      'NotFound',
      'Conflict',
      'PreconditionFailed',
      'TooManyRequests',
      'InternalError',
    ]) {
      expect(contract.components.responses).toHaveProperty(name);
    }
  });
});

describe('SharedErrorCode', () => {
  it('has unique values', () => {
    const values = Object.values(SharedErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it('uses lowercase dotted codes', () => {
    for (const value of Object.values(SharedErrorCode)) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });
});

describe('isApiError', () => {
  it('accepts a well-formed envelope', () => {
    expect(
      isApiError({
        error: {
          code: 'auth.forbidden',
          message: 'Not permitted.',
          correlationId: 'abc',
          retryable: false,
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'error'],
    ['an empty object', {}],
    ['a missing code', { error: { message: 'x' } }],
    ['a non-string code', { error: { code: 42 } }],
  ])('rejects %s', (_name, value) => {
    expect(isApiError(value)).toBe(false);
  });
});
