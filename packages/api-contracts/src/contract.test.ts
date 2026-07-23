import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  API_BASE_PATH,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  SharedErrorCode,
  SyncErrorCode,
  isApiError,
} from './index.js';

interface OperationParameter {
  readonly $ref?: string;
  readonly name?: string;
  readonly in?: string;
}

interface Operation {
  readonly operationId?: string;
  readonly summary?: string;
  readonly parameters?: readonly OperationParameter[];
  readonly requestBody?: unknown;
  readonly responses?: Record<string, unknown>;
}

interface SchemaDocument {
  readonly required?: readonly string[];
  readonly properties?: Record<string, unknown>;
  readonly enum?: readonly string[];
  readonly oneOf?: readonly { $ref: string }[];
  readonly discriminator?: { readonly mapping?: Record<string, string> };
}

interface ContractDocument {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, SchemaDocument>;
    parameters: Record<string, unknown>;
    responses: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
}

const contractPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
const contract = parse(readFileSync(contractPath, 'utf8')) as ContractDocument;

/** Every $ref parameter name an operation declares, resolved against `components.parameters`. */
function referencedParameterNames(operation: Operation): string[] {
  return (operation.parameters ?? [])
    .map((parameter) => parameter.$ref?.replace('#/components/parameters/', ''))
    .filter((name): name is string => name !== undefined);
}

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

/** Looks up one operation by path and HTTP method, failing the test immediately when absent. */
function requireOperation(path: string, method: string): Operation {
  const operation = contract.paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path} is not defined in the contract`).toBeDefined();
  return operation!;
}

/** Looks up one named schema, failing the test immediately when absent. */
function requireSchema(name: string): SchemaDocument {
  const schema = contract.components.schemas[name];
  expect(schema, `schema ${name} is not defined in the contract`).toBeDefined();
  return schema!;
}

describe('Synchronization endpoints (P5-API-01)', () => {
  it('exposes push, changes, acknowledge, and client registration under the Synchronization tag', () => {
    expect(requireOperation('/sync/push', 'post').operationId).toBe('pushSyncOperations');
    expect(requireOperation('/sync/changes', 'get').operationId).toBe('getSyncChanges');
    expect(requireOperation('/sync/acknowledge', 'post').operationId).toBe(
      'acknowledgeSyncOperations',
    );
    expect(requireOperation('/sync/clients/{clientInstallationId}', 'put').operationId).toBe(
      'registerSyncClient',
    );
  });

  it('does not use the shared Idempotency-Key or If-Match headers on push, changes, or acknowledge', () => {
    // Push's idempotency key is each operation's own `operationId` (section
    // "9. Server Idempotency"); expected revisions travel inside each
    // command payload, not a request-level `If-Match` (some commands need
    // more than one). Changes is a read. Acknowledge performs no mutation.
    for (const operation of [
      requireOperation('/sync/push', 'post'),
      requireOperation('/sync/changes', 'get'),
      requireOperation('/sync/acknowledge', 'post'),
    ]) {
      const names = referencedParameterNames(operation);
      expect(names).not.toContain('IdempotencyKey');
      expect(names).not.toContain('IfMatch');
    }
  });

  it('requires the shared Idempotency-Key header on client registration, like every other mutation', () => {
    const registration = requireOperation('/sync/clients/{clientInstallationId}', 'put');
    expect(referencedParameterNames(registration)).toContain('IdempotencyKey');
  });

  it('pulls changes with an `after` cursor, not the ordinary shared `cursor` parameter', () => {
    const changes = requireOperation('/sync/changes', 'get');
    const names = referencedParameterNames(changes);
    expect(names).toContain('SyncAfterCursor');
    expect(names).not.toContain('Cursor');

    const afterCursor = contract.components.parameters['SyncAfterCursor'] as { name: string };
    expect(afterCursor.name).toBe('after');
  });

  it('always returns a nextCursor from SyncChangesResult, unlike ordinary list results', () => {
    expect(requireSchema('SyncChangesResult').required).toContain('nextCursor');
    expect(requireSchema('GardenListResult').required).not.toContain('nextCursor');
  });

  it('requires the fields section 8 (Push Protocol) and section 21 (Protocol Versioning) name on SyncPushRequest', () => {
    expect(requireSchema('SyncPushRequest').required).toEqual(
      expect.arrayContaining([
        'clientInstallationId',
        'protocolVersion',
        'operationPayloadVersion',
        'operations',
      ]),
    );
  });

  it('acknowledges by bare operation IDs, with no payload field anywhere on the request', () => {
    const acknowledgeRequest = requireSchema('SyncAcknowledgeRequest');
    expect(acknowledgeRequest.required).toEqual(
      expect.arrayContaining(['clientInstallationId', 'operationIds']),
    );
    expect(acknowledgeRequest.properties).not.toHaveProperty('payload');
    expect(acknowledgeRequest.properties).not.toHaveProperty('operations');
  });
});

describe('SyncRecordType parity with services/api', () => {
  it('matches the record types services/api/src/platform/sync/sync-record-type.ts actually writes', () => {
    // Cross-checks against the real backend source rather than trusting the
    // contract in isolation: `platform.sync_change.record_type` has no
    // database CHECK constraint (see that file's own header comment), so
    // this TypeScript union is the only safety net against the two drifting
    // apart. Read only — this stage never modifies services/api/src.
    const sourcePath = fileURLToPath(
      new URL('../../../services/api/src/platform/sync/sync-record-type.ts', import.meta.url),
    );
    const source = readFileSync(sourcePath, 'utf8');
    const objectBody = source.match(/export const SyncRecordType = \{([\s\S]*?)\} as const;/)?.[1];
    expect(objectBody).toBeDefined();

    const backendValues = [...objectBody!.matchAll(/:\s*'([a-zA-Z]+)'/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined)
      .sort();

    const recordType = requireSchema('SyncRecordType');
    expect([...(recordType.enum ?? [])].sort()).toEqual(backendValues);
  });
});

describe('Sync discriminated unions', () => {
  it('groups SyncOperationPayload by exactly the record-type families this codebase established', () => {
    const payload = requireSchema('SyncOperationPayload');
    expect(Object.keys(payload.discriminator?.mapping ?? {}).sort()).toEqual(
      ['garden', 'gardenObject', 'observation', 'plant', 'task'].sort(),
    );
  });

  it('names the exact six push outcomes section 8 (Push Protocol) defines, no more and no fewer', () => {
    const result = requireSchema('SyncPushOperationResult');
    expect(Object.keys(result.discriminator?.mapping ?? {}).sort()).toEqual(
      ['accepted', 'blockedByDependency', 'conflict', 'duplicate', 'rejected', 'retryLater'].sort(),
    );
  });

  it('extends the push outcomes with exactly one more case, unknown, for acknowledge lookups', () => {
    const pushOutcomes = Object.keys(
      requireSchema('SyncPushOperationResult').discriminator?.mapping ?? {},
    );
    const lookupOutcomes = Object.keys(
      requireSchema('SyncOperationLookupResult').discriminator?.mapping ?? {},
    );
    expect(lookupOutcomes.sort()).toEqual([...pushOutcomes, 'unknown'].sort());
  });

  it('covers every SyncRecordType value in SyncRecordSnapshot', () => {
    const recordType = requireSchema('SyncRecordType');
    const snapshot = requireSchema('SyncRecordSnapshot');
    expect(Object.keys(snapshot.discriminator?.mapping ?? {}).sort()).toEqual(
      [...(recordType.enum ?? [])].sort(),
    );
  });
});

describe('SyncErrorCode', () => {
  it('has unique values', () => {
    const values = Object.values(SyncErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it('uses lowercase dotted codes', () => {
    for (const value of Object.values(SyncErrorCode)) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });
});
