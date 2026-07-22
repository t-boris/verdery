/**
 * Small, reusable hand-written request-body parsers, in the same
 * hand-written-validation convention `garden-routes.ts`'s own header comment
 * describes — no generated Fastify JSON-schema bridge exists yet. Shared by
 * `parse-geometry.ts`, `parse-garden-object-details.ts`, and
 * `parse-map-command-payload.ts` so the same primitive check is not
 * reimplemented per field.
 */

import { UUID_PATTERN, invalid } from './garden-routes.js';

export function requireRecord(value: unknown, pointer: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${pointer} must be an object.`, 'request.invalid', pointer);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, pointer: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${pointer} must be a string.`, 'request.invalid', pointer);
  }
  return value;
}

export function requireOptionalString(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireString(value, pointer);
}

export function requireUuid(value: unknown, pointer: string): string {
  const candidate = requireString(value, pointer);
  if (!UUID_PATTERN.test(candidate)) {
    throw invalid(`${pointer} must be a UUID.`, 'request.uuid.invalid', pointer);
  }
  return candidate;
}

export function requireOptionalUuid(value: unknown, pointer: string): string | undefined {
  return value === undefined ? undefined : requireUuid(value, pointer);
}

/** `Uuid | null`, matching `AssignPlantCommand.targetObjectId`. */
export function requireUuidOrNull(value: unknown, pointer: string): string | null {
  if (value === null) {
    return null;
  }
  return requireUuid(value, pointer);
}

export function requireNumber(value: unknown, pointer: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${pointer} must be a finite number.`, 'request.invalid', pointer);
  }
  return value;
}

export function requireOptionalNumber(value: unknown, pointer: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, pointer);
}

export function requireInteger(value: unknown, pointer: string, minimum?: number): number {
  const candidate = requireNumber(value, pointer);
  if (!Number.isInteger(candidate) || (minimum !== undefined && candidate < minimum)) {
    throw invalid(
      `${pointer} must be an integer${minimum === undefined ? '' : ` >= ${String(minimum)}`}.`,
      'request.invalid',
      pointer,
    );
  }
  return candidate;
}

export function requireDateTime(value: unknown, pointer: string): string {
  const candidate = requireString(value, pointer);
  if (Number.isNaN(Date.parse(candidate))) {
    throw invalid(`${pointer} must be an RFC 3339 timestamp.`, 'request.invalid', pointer);
  }
  return candidate;
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pointer: string,
): T {
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
