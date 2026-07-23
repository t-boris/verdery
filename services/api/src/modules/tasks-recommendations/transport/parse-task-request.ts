/**
 * Hand-written request-body parsers for the `Tasks` tag, in the same
 * hand-written-validation convention `garden-routes.ts`'s own header comment
 * describes. Small, local primitive checks mirror
 * `gardens-mapping/transport/parse-primitives.ts`'s style without importing
 * it — see `plants-inventory/transport/parse-plant-request.ts`'s identical
 * header comment for why.
 *
 * `CreateManualTaskInput`/`EditTaskChanges`/`RescheduleTaskInput` carry
 * `Date`-typed `timeWindow.start`/`timeWindow.end` (unlike this module's own
 * `Task.timeWindowStart`/`timeWindowEnd`, which are wire-level ISO strings
 * once through `toTaskResource`) — every timestamp field parsed here is
 * converted from the RFC 3339 wire string to a `Date` before being handed to
 * a command, never left as a string.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Tasks`;
 * implementation-plan.md work package P4-CONTRACT-01.
 */

import { UUID_PATTERN, invalid } from '../../gardens-mapping/transport/garden-routes.js';
import type {
  CreateManualTaskInput,
  CreateManualTaskTargetInput,
} from '../application/create-manual-task.js';
import type { EditTaskChanges } from '../application/edit-task.js';
import type { RescheduleTaskInput } from '../application/reschedule-task.js';
import type { AttachTaskFileInput } from '../application/attach-task-file.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import type { TaskTargetKind, TaskUrgency } from '../domain/task.js';

const TASK_TARGET_KINDS: readonly TaskTargetKind[] = ['garden', 'garden_area', 'plant'];
const TASK_URGENCIES: readonly TaskUrgency[] = ['low', 'normal', 'high', 'urgent'];
export const TASK_STATUSES: readonly TaskStatus[] = [
  'planned',
  'suggested',
  'completed',
  'skipped',
  'dismissed',
  'deleted',
];

function requireRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(
      `${pointer || 'the request body'} must be an object.`,
      'request.invalid',
      pointer,
    );
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, pointer: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${pointer} must be a string.`, 'request.invalid', pointer);
  }
  return value;
}

function requireOptionalString(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireString(value, pointer);
}

function optionalNullableString(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, pointer);
}

function requireUuid(value: unknown, pointer: string): string {
  const candidate = requireString(value, pointer);
  if (!UUID_PATTERN.test(candidate)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return candidate;
}

function requireOptionalUuid(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireUuid(value, pointer);
}

function optionalNullableUuid(value: unknown, pointer: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireUuid(value, pointer);
}

function requireTimestamp(value: unknown, pointer: string): Date {
  const candidate = requireString(value, pointer);
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`${pointer} must be an RFC 3339 timestamp.`, 'request.invalid', pointer);
  }
  return parsed;
}

function optionalNullableTimestamp(value: unknown, pointer: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireTimestamp(value, pointer);
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], pointer: string): T {
  const candidate = requireString(value, pointer);
  if (!(allowed as readonly string[]).includes(candidate)) {
    throw invalid(
      `${pointer} must be one of: ${allowed.join(', ')}.`,
      'request.enum.invalid',
      pointer,
    );
  }
  return candidate as T;
}

function requireOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pointer: string,
): T | undefined {
  return value === undefined ? undefined : requireEnum(value, allowed, pointer);
}

/**
 * Shared shape every `timeWindow` input (`CreateManualTaskTimeWindowInput`,
 * `EditTaskTimeWindowInput`, `RescheduleTaskTimeWindowInput`) has in common.
 * Parsed once here and returned as a plain object literal that structurally
 * satisfies all three — they are field-for-field identical types, so no
 * unsafe cast is needed for the result to assign into any of them.
 */
function parseTimeWindow(
  value: unknown,
  pointer: string,
): { start?: Date | null; end?: Date | null } | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, pointer);
  const start = optionalNullableTimestamp(record['start'], `${pointer}/start`);
  const end = optionalNullableTimestamp(record['end'], `${pointer}/end`);

  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  };
}

function parseTarget(value: unknown, pointer: string): CreateManualTaskTargetInput {
  const record = requireRecord(value, pointer);
  const kind = requireEnum(record['kind'], TASK_TARGET_KINDS, `${pointer}/kind`);
  const gardenAreaMapObjectId = requireOptionalUuid(
    record['gardenAreaMapObjectId'],
    `${pointer}/gardenAreaMapObjectId`,
  );
  const plantId = requireOptionalUuid(record['plantId'], `${pointer}/plantId`);

  return {
    kind,
    ...(gardenAreaMapObjectId === undefined ? {} : { gardenAreaMapObjectId }),
    ...(plantId === undefined ? {} : { plantId }),
  };
}

export function parseCreateManualTaskRequest(body: unknown): CreateManualTaskInput {
  const record = requireRecord(body, '');
  const target = parseTarget(record['target'], '/target');
  const title = requireString(record['title'], '/title');
  const notes = optionalNullableString(record['notes'], '/notes');
  const dueDate = optionalNullableString(record['dueDate'], '/dueDate');
  const timeWindow = parseTimeWindow(record['timeWindow'], '/timeWindow');
  const urgency = requireOptionalEnum(record['urgency'], TASK_URGENCIES, '/urgency');
  const originObservationId = optionalNullableUuid(
    record['originObservationId'],
    '/originObservationId',
  );

  return {
    target,
    title,
    ...(notes === undefined ? {} : { notes }),
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(timeWindow === undefined ? {} : { timeWindow }),
    ...(urgency === undefined ? {} : { urgency }),
    ...(originObservationId === undefined ? {} : { originObservationId }),
  };
}

export function parseEditTaskRequest(body: unknown): EditTaskChanges {
  const record = requireRecord(body, '');
  const title = requireOptionalString(record['title'], '/title');
  const notes = optionalNullableString(record['notes'], '/notes');
  const dueDate = optionalNullableString(record['dueDate'], '/dueDate');
  const timeWindow = parseTimeWindow(record['timeWindow'], '/timeWindow');
  const urgency = requireOptionalEnum(record['urgency'], TASK_URGENCIES, '/urgency');
  const recurrenceRule = optionalNullableString(record['recurrenceRule'], '/recurrenceRule');

  return {
    ...(title === undefined ? {} : { title }),
    ...(notes === undefined ? {} : { notes }),
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(timeWindow === undefined ? {} : { timeWindow }),
    ...(urgency === undefined ? {} : { urgency }),
    ...(recurrenceRule === undefined ? {} : { recurrenceRule }),
  };
}

export function parseRescheduleTaskRequest(body: unknown): RescheduleTaskInput {
  const record = requireRecord(body, '');
  const dueDate = optionalNullableString(record['dueDate'], '/dueDate');
  const timeWindow = parseTimeWindow(record['timeWindow'], '/timeWindow');

  return {
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(timeWindow === undefined ? {} : { timeWindow }),
  };
}

export function parseCompletionNote(body: unknown): string | null | undefined {
  if (body === undefined) return undefined;
  const record = requireRecord(body, '');
  return optionalNullableString(record['completionNote'], '/completionNote');
}

export function parseDismissReason(body: unknown): string | null | undefined {
  if (body === undefined) return undefined;
  const record = requireRecord(body, '');
  return optionalNullableString(record['reason'], '/reason');
}

export function parseAttachTaskFileRequest(body: unknown): AttachTaskFileInput {
  const record = requireRecord(body, '');
  const mediaId = requireUuid(record['mediaId'], '/mediaId');

  return { mediaId };
}
