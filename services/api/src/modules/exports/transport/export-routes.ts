/**
 * Exports HTTP routes (P8-EXPORT-01) — hand-written request validation
 * against `openapi.yaml`'s `Exports` tag, matching every other transport
 * layer in this codebase (see `garden-routes.ts`'s own header comment for
 * the rationale). One structured log line per request command, ids and
 * outcomes only — never package contents or signed URLs
 * (architecture/data-export-and-deletion.md section 9: "Export URLs and
 * contents are never logged").
 */

import type { ExportRequest, MediaAccess } from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { ExportScope } from '../domain/export-request.js';
import type { GetExportDownload } from '../application/get-export-download.js';
import type { GetExportRequest } from '../application/get-export-request.js';
import type { RequestExport, RequestExportInput } from '../application/request-export.js';

export interface ExportRoutesDependencies {
  readonly requestExport: RequestExport;
  readonly getExportRequest: GetExportRequest;
  readonly getExportDownload: GetExportDownload;
}

const EXPORT_SCOPES: readonly ExportScope[] = ['account', 'garden'];

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requireExportRequestId(request: FastifyRequest): string {
  const { exportRequestId } = request.params as { exportRequestId?: unknown };

  if (typeof exportRequestId !== 'string' || !UUID_PATTERN.test(exportRequestId)) {
    throw invalid(
      'exportRequestId must be a UUID.',
      'request.export_request_id.invalid',
      '/exportRequestId',
    );
  }

  return exportRequestId;
}

function requireIdempotencyKey(request: FastifyRequest): string {
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

function requireCreateExportRequestBody(request: FastifyRequest): RequestExportInput {
  const body = request.body as
    { scope?: unknown; gardenId?: unknown; includeMedia?: unknown } | undefined;

  if (typeof body?.scope !== 'string' || !EXPORT_SCOPES.includes(body.scope as ExportScope)) {
    throw invalid("scope must be 'account' or 'garden'.", 'request.scope.invalid', '/scope');
  }
  if (
    body.gardenId !== undefined &&
    (typeof body.gardenId !== 'string' || !UUID_PATTERN.test(body.gardenId))
  ) {
    throw invalid('gardenId must be a UUID.', 'request.garden_id.invalid', '/gardenId');
  }
  if (body.includeMedia !== undefined && typeof body.includeMedia !== 'boolean') {
    throw invalid(
      'includeMedia must be a boolean.',
      'request.include_media.invalid',
      '/includeMedia',
    );
  }

  return {
    scope: body.scope as ExportScope,
    gardenId: typeof body.gardenId === 'string' ? body.gardenId : null,
    includeMedia: body.includeMedia !== false,
  };
}

export function registerExportRoutes(
  app: FastifyInstance,
  dependencies: ExportRoutesDependencies,
): void {
  app.post('/exports', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireCreateExportRequestBody(request);

    const resource: ExportRequest = await dependencies.requestExport.execute(
      request.actorContext,
      body,
      idempotencyKey,
    );

    request.log.info(
      {
        event: 'export.requested',
        exportRequestId: resource.id,
        scope: resource.scope,
        includeMedia: resource.includeMedia,
      },
      'Data export requested',
    );

    return reply.status(201).send(resource);
  });

  app.get('/exports/:exportRequestId', async (request, reply) => {
    const exportRequestId = requireExportRequestId(request);

    const resource: ExportRequest = await dependencies.getExportRequest.execute(
      exportRequestId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(resource);
  });

  app.get('/exports/:exportRequestId/download', async (request, reply) => {
    const exportRequestId = requireExportRequestId(request);

    const access: MediaAccess = await dependencies.getExportDownload.execute(
      exportRequestId,
      request.actorContext.profileId,
    );

    // Deliberately no URL in the log — section 9.
    request.log.info(
      { event: 'export.download_authorized', exportRequestId },
      'Export download URL issued',
    );

    return reply.status(200).send(access);
  });
}
