/**
 * Hand-written request parsing for the three synchronization routes, the
 * same convention every other transport layer in this codebase uses (see
 * `gardens-mapping/transport/garden-routes.ts`'s own header comment) rather
 * than a generated Fastify/AJV schema bridge — including that file's own
 * "cast to a narrow shape with `?: unknown` fields, not a generic index
 * signature" style, which is what every field access below uses.
 *
 * Validation depth is deliberately uneven across the three requests, by
 * design, not oversight:
 *
 * - `SyncClientRegistrationRequest`/`SyncAcknowledgeRequest` are fully
 *   validated here — small, flat shapes with no per-item business routing.
 * - `SyncPushRequest` is validated only down to what is needed to safely
 *   *identify and report* each operation (`operationId`, `payload.recordType`,
 *   `payload.gardenId`, the command's own discriminator) — envelope-level
 *   problems (missing `operations`, a batch over 500 items, an operation
 *   with no parseable `operationId`) fail the whole request with `400`,
 *   exactly as the OpenAPI operation's own description requires ("Only a
 *   request-level problem... fails before any operation is processed").
 *   Everything below that — a malformed `request` sub-object, an unknown
 *   `commandType` inside an otherwise well-formed operation — is
 *   deliberately left to the router/sibling command to reject as a
 *   per-operation `rejected` result, not a batch-level `400`, matching that
 *   same sentence's other half ("an individual operation... conflicting,
 *   being rejected, or being blocked never fails the whole batch").
 */

import type {
  SyncAcknowledgeRequest,
  SyncClientPlatform,
  SyncClientRegistrationRequest,
  SyncOperation,
  SyncOperationPayload,
  SyncPushRequest,
  SyncRecordType,
} from '@verdery/api-contracts';
import { UUID_PATTERN, invalid } from '../../gardens-mapping/transport/garden-routes.js';

const MAX_PUSH_BATCH_SIZE = 500;
const MAX_ACKNOWLEDGE_BATCH_SIZE = 500;
const MAX_DEPENDS_ON_IDS = 20;
const RECORD_TYPES: readonly SyncRecordType[] = [
  'garden',
  'gardenObject',
  'plant',
  'observation',
  'task',
];

interface RegistrationRequestShape {
  platform?: unknown;
  appVersion?: unknown;
  protocolVersion?: unknown;
}

interface OperationPayloadShape {
  recordType?: unknown;
  gardenId?: unknown;
  command?: unknown;
}

interface OperationShape {
  operationId?: unknown;
  localSequence?: unknown;
  dependsOnOperationIds?: unknown;
  commandVersion?: unknown;
  mediaPrerequisites?: unknown;
  payload?: unknown;
}

interface PushRequestShape {
  clientInstallationId?: unknown;
  protocolVersion?: unknown;
  operationPayloadVersion?: unknown;
  operations?: unknown;
}

interface AcknowledgeRequestShape {
  clientInstallationId?: unknown;
  operationIds?: unknown;
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireUuidField(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return value;
}

function requirePositiveInteger(value: unknown, pointer: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid(`${pointer} must be a positive integer.`, 'request.integer.invalid', pointer);
  }
  return value;
}

export function parseSyncClientRegistrationRequest(body: unknown): SyncClientRegistrationRequest {
  if (!isPlainObject(body)) {
    throw invalid('Request body must be an object.', 'request.body.invalid', '/');
  }
  const request = body as RegistrationRequestShape;

  const { platform } = request;
  if (platform !== 'ios' && platform !== 'web') {
    throw invalid('platform must be "ios" or "web".', 'request.platform.invalid', '/platform');
  }

  const { appVersion } = request;
  if (typeof appVersion !== 'string' || appVersion.trim().length === 0) {
    throw invalid(
      'appVersion must be a non-empty string.',
      'request.app_version.invalid',
      '/appVersion',
    );
  }

  const protocolVersion = requirePositiveInteger(request.protocolVersion, '/protocolVersion');

  return { platform: platform satisfies SyncClientPlatform, appVersion, protocolVersion };
}

function requireOperationPayload(value: unknown, pointer: string): SyncOperationPayload {
  if (!isPlainObject(value)) {
    throw invalid(`${pointer} must be an object.`, 'request.payload.invalid', pointer);
  }
  const payload = value as OperationPayloadShape;

  const { recordType } = payload;
  if (typeof recordType !== 'string' || !RECORD_TYPES.includes(recordType as SyncRecordType)) {
    throw invalid(
      `${pointer}/recordType must be one of ${RECORD_TYPES.join(', ')}.`,
      'request.record_type.invalid',
      `${pointer}/recordType`,
    );
  }

  requireUuidField(payload.gardenId, `${pointer}/gardenId`);

  if (!isPlainObject(payload.command)) {
    throw invalid(
      `${pointer}/command must be an object.`,
      'request.command.invalid',
      `${pointer}/command`,
    );
  }
  const command = payload.command as { type?: unknown; commandType?: unknown };

  // The command's own discriminator (`commandType` for every family except
  // `gardenObject`, which discriminates on `type` — see
  // `SyncGardenObjectOperationPayload`'s own description) is checked for
  // presence only; its exact recognized value is validated by the router
  // dispatch itself (an unrecognized one falls through to a `rejected`
  // result there, per this file's own header comment).
  const discriminator = recordType === 'gardenObject' ? command.type : command.commandType;
  if (typeof discriminator !== 'string' || discriminator.length === 0) {
    const field = recordType === 'gardenObject' ? 'type' : 'commandType';
    throw invalid(
      `${pointer}/command/${field} is required.`,
      'request.command_type.invalid',
      `${pointer}/command/${field}`,
    );
  }

  return value as unknown as SyncOperationPayload;
}

function parseSyncOperation(value: unknown, index: number): SyncOperation {
  const pointer = `/operations/${index}`;
  if (!isPlainObject(value)) {
    throw invalid(`${pointer} must be an object.`, 'request.operation.invalid', pointer);
  }
  const operation = value as OperationShape;

  const operationId = requireUuidField(operation.operationId, `${pointer}/operationId`);

  const { localSequence } = operation;
  if (typeof localSequence !== 'number' || !Number.isInteger(localSequence) || localSequence < 0) {
    throw invalid(
      `${pointer}/localSequence must be a non-negative integer.`,
      'request.local_sequence.invalid',
      `${pointer}/localSequence`,
    );
  }

  let dependsOnOperationIds: string[] = [];
  if (operation.dependsOnOperationIds !== undefined) {
    if (
      !Array.isArray(operation.dependsOnOperationIds) ||
      operation.dependsOnOperationIds.length > MAX_DEPENDS_ON_IDS
    ) {
      throw invalid(
        `${pointer}/dependsOnOperationIds must be an array of at most ${MAX_DEPENDS_ON_IDS} UUIDs.`,
        'request.depends_on_operation_ids.invalid',
        `${pointer}/dependsOnOperationIds`,
      );
    }
    dependsOnOperationIds = operation.dependsOnOperationIds.map((id: unknown, depIndex: number) =>
      requireUuidField(id, `${pointer}/dependsOnOperationIds/${depIndex}`),
    );
  }

  const payload = requireOperationPayload(operation.payload, `${pointer}/payload`);

  return {
    operationId,
    localSequence,
    dependsOnOperationIds,
    mediaPrerequisites:
      operation.mediaPrerequisites === undefined
        ? []
        : (operation.mediaPrerequisites as NonNullable<SyncOperation['mediaPrerequisites']>),
    ...(operation.commandVersion === undefined
      ? {}
      : { commandVersion: operation.commandVersion as number }),
    payload,
  };
}

export function parseSyncPushRequest(body: unknown): SyncPushRequest {
  if (!isPlainObject(body)) {
    throw invalid('Request body must be an object.', 'request.body.invalid', '/');
  }
  const request = body as PushRequestShape;

  const clientInstallationId = requireUuidField(
    request.clientInstallationId,
    '/clientInstallationId',
  );
  const protocolVersion = requirePositiveInteger(request.protocolVersion, '/protocolVersion');
  const operationPayloadVersion = requirePositiveInteger(
    request.operationPayloadVersion,
    '/operationPayloadVersion',
  );

  const { operations: rawOperations } = request;
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    throw invalid(
      'operations must be a non-empty array.',
      'request.operations.invalid',
      '/operations',
    );
  }
  if (rawOperations.length > MAX_PUSH_BATCH_SIZE) {
    throw invalid(
      `operations must not exceed ${MAX_PUSH_BATCH_SIZE} items.`,
      'request.operations.too_large',
      '/operations',
    );
  }

  const operations = rawOperations.map((operation: unknown, index: number) =>
    parseSyncOperation(operation, index),
  );

  return { clientInstallationId, protocolVersion, operationPayloadVersion, operations };
}

export function parseSyncAcknowledgeRequest(body: unknown): SyncAcknowledgeRequest {
  if (!isPlainObject(body)) {
    throw invalid('Request body must be an object.', 'request.body.invalid', '/');
  }
  const request = body as AcknowledgeRequestShape;

  const clientInstallationId = requireUuidField(
    request.clientInstallationId,
    '/clientInstallationId',
  );

  const { operationIds: rawOperationIds } = request;
  if (!Array.isArray(rawOperationIds) || rawOperationIds.length === 0) {
    throw invalid(
      'operationIds must be a non-empty array.',
      'request.operation_ids.invalid',
      '/operationIds',
    );
  }
  if (rawOperationIds.length > MAX_ACKNOWLEDGE_BATCH_SIZE) {
    throw invalid(
      `operationIds must not exceed ${MAX_ACKNOWLEDGE_BATCH_SIZE} items.`,
      'request.operation_ids.too_large',
      '/operationIds',
    );
  }

  const operationIds = rawOperationIds.map((id: unknown, index: number) =>
    requireUuidField(id, `/operationIds/${index}`),
  );

  return { clientInstallationId, operationIds };
}
