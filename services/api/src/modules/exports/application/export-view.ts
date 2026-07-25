/**
 * Read-model mapping for the Exports contract surface (P8-EXPORT-01) —
 * purpose-built resources matching `openapi.yaml`'s `ExportRequest`
 * schema, never persistence rows. Storage detail (bucket, object key,
 * pre-minted media id) and session context deliberately never leave the
 * server through this view.
 */

import type { ExportRequest as ExportRequestResource } from '@verdery/api-contracts';
import type { ExportRequest } from '../domain/export-request.js';

export function toExportRequestResource(request: ExportRequest): ExportRequestResource {
  return {
    id: request.id,
    scope: request.scope,
    gardenId: request.gardenId,
    includeMedia: request.includeMedia,
    formatVersion: request.formatVersion,
    state: request.state,
    boundaryAt: request.boundaryAt === null ? null : request.boundaryAt.toISOString(),
    outputChecksumSha256: request.outputChecksumSha256,
    failureCode: request.failureCode,
    expiresAt: request.expiresAt === null ? null : request.expiresAt.toISOString(),
    completedAt: request.completedAt === null ? null : request.completedAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}
