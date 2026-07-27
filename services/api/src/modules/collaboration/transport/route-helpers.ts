/**
 * Shared hand-written request-parsing helpers for this module's transport
 * layer — the same "hand-written validation against the same rules the
 * OpenAPI document declares" posture `gardens-mapping/transport/
 * garden-routes.ts`'s own header documents, reusing that file's
 * `UUID_PATTERN`/`invalid` directly (imported from its own file, not through
 * `gardens-mapping/public.ts`) — the identical cross-module reuse
 * `media/transport/media-routes.ts` and `tasks-recommendations/transport/
 * task-routes.ts` already establish for the same two symbols.
 */

import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';
import type { FastifyRequest } from 'fastify';
import {
  invalid,
  requireExpectedRevision,
  UUID_PATTERN,
} from '../../gardens-mapping/transport/garden-routes.js';

export { UUID_PATTERN, invalid, requireExpectedRevision };

function requireUuidParam(request: FastifyRequest, paramName: string, pointerName: string): string {
  const params = request.params as Record<string, unknown>;
  const value = params[paramName];

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalid(
      `${pointerName} must be a UUID.`,
      `request.${pointerName}.invalid`,
      `/${pointerName}`,
    );
  }

  return value;
}

export function requireOrganizationId(request: FastifyRequest): string {
  return requireUuidParam(request, 'organizationId', 'organizationId');
}

export function requireGardenId(request: FastifyRequest): string {
  return requireUuidParam(request, 'gardenId', 'gardenId');
}

export function requireProfileId(request: FastifyRequest): string {
  return requireUuidParam(request, 'profileId', 'profileId');
}

export function requireAssignmentId(request: FastifyRequest): string {
  return requireUuidParam(request, 'assignmentId', 'assignmentId');
}

export function requireEngagementId(request: FastifyRequest): string {
  return requireUuidParam(request, 'engagementId', 'engagementId');
}

export function requireClientUpdateId(request: FastifyRequest): string {
  return requireUuidParam(request, 'clientUpdateId', 'clientUpdateId');
}

export function requireItemId(request: FastifyRequest): string {
  return requireUuidParam(request, 'itemId', 'itemId');
}

export function requireGrantId(request: FastifyRequest): string {
  return requireUuidParam(request, 'grantId', 'grantId');
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  const key = Array.isArray(header) ? header[0] : header;

  if (typeof key !== 'string' || !UUID_PATTERN.test(key)) {
    throw invalid(
      `${IDEMPOTENCY_KEY_HEADER} header must be a UUID.`,
      'request.idempotency_key.invalid',
      `/headers/${IDEMPOTENCY_KEY_HEADER}`,
    );
  }

  return key;
}
