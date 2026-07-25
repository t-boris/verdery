/**
 * The export-generation worker's three internal endpoints (P8-EXPORT-01):
 * snapshot, checkpoints, completion. Machine-to-machine, OIDC-verified by
 * the same `cloudTasksInvocationVerifier` every worker-to-API endpoint
 * shares — the `media-processing-callback-route.ts` posture: outside the
 * Firebase session pipeline and outside public OpenAPI (the contract lives
 * in `@verdery/api-contracts`' `export-processing.ts`).
 *
 * Body validation is structural (the producer is this repository's own
 * worker — a malformed body is a defect between trusted components,
 * rejected loudly), matching the notification events route's posture.
 */

import type {
  ExportCheckpointRequest,
  ExportCompletionRequest,
  ExportSectionCheckpoint,
} from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CloudTasksInvocationVerifier } from '../../../platform/tasks/cloud-tasks-invocation-verifier.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { CompleteExport } from '../application/complete-export.js';
import type { RecordExportCheckpoints } from '../application/record-export-checkpoints.js';
import type { RunExportSnapshot } from '../application/run-export-snapshot.js';

export interface ExportInternalRoutesDependencies {
  readonly runExportSnapshot: RunExportSnapshot;
  readonly recordExportCheckpoints: RecordExportCheckpoints;
  readonly completeExport: CompleteExport;
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
}

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

function invalid(message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code: 'export.internal.request_invalid', pointer }],
  });
}

function requireExportRequestId(request: FastifyRequest): string {
  const { exportRequestId } = request.params as { exportRequestId?: unknown };
  if (typeof exportRequestId !== 'string' || !UUID_PATTERN.test(exportRequestId)) {
    throw invalid('exportRequestId must be a UUID.', '/exportRequestId');
  }
  return exportRequestId;
}

function requireSectionCheckpoint(value: unknown, pointer: string): ExportSectionCheckpoint {
  const section = value as Partial<ExportSectionCheckpoint> | null | undefined;
  if (typeof section !== 'object' || section === null) {
    throw invalid('each section must be an object.', pointer);
  }
  if (typeof section.entryPath !== 'string' || section.entryPath === '') {
    throw invalid('entryPath is required.', `${pointer}/entryPath`);
  }
  if (section.disposition !== 'package' && section.disposition !== 'transfer') {
    throw invalid("disposition must be 'package' or 'transfer'.", `${pointer}/disposition`);
  }
  if (typeof section.bucketName !== 'string' || section.bucketName === '') {
    throw invalid('bucketName is required.', `${pointer}/bucketName`);
  }
  if (typeof section.objectKey !== 'string' || section.objectKey === '') {
    throw invalid('objectKey is required.', `${pointer}/objectKey`);
  }
  if (typeof section.contentType !== 'string' || section.contentType === '') {
    throw invalid('contentType is required.', `${pointer}/contentType`);
  }
  if (
    typeof section.checksumSha256 !== 'string' ||
    !CHECKSUM_PATTERN.test(section.checksumSha256)
  ) {
    throw invalid(
      'checksumSha256 must be 64 lowercase hex characters.',
      `${pointer}/checksumSha256`,
    );
  }
  if (
    typeof section.byteSize !== 'number' ||
    !Number.isInteger(section.byteSize) ||
    section.byteSize < 0
  ) {
    throw invalid('byteSize must be a non-negative integer.', `${pointer}/byteSize`);
  }
  return section as ExportSectionCheckpoint;
}

function requireCheckpointBody(request: FastifyRequest): ExportCheckpointRequest {
  const body = request.body as { boundaryAt?: unknown; sections?: unknown } | undefined;
  if (typeof body?.boundaryAt !== 'string') {
    throw invalid('boundaryAt is required.', '/boundaryAt');
  }
  if (!Array.isArray(body.sections)) {
    throw invalid('sections must be an array.', '/sections');
  }
  return {
    boundaryAt: body.boundaryAt,
    sections: body.sections.map((section, index) =>
      requireSectionCheckpoint(section, `/sections/${String(index)}`),
    ),
  };
}

function requireCompletionBody(request: FastifyRequest): ExportCompletionRequest {
  const body = request.body as
    { outcome?: unknown; package?: unknown; failureCode?: unknown } | undefined;
  if (body?.outcome !== 'succeeded' && body?.outcome !== 'failed_terminal') {
    throw invalid("outcome must be 'succeeded' or 'failed_terminal'.", '/outcome');
  }
  if (body.failureCode !== undefined && typeof body.failureCode !== 'string') {
    throw invalid('failureCode must be a string.', '/failureCode');
  }

  let packageFacts: ExportCompletionRequest['package'];
  if (body.package !== undefined) {
    const raw = body.package as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) {
      throw invalid('package must be an object.', '/package');
    }
    const section = requireSectionCheckpoint(
      { ...raw, entryPath: 'package.zip', disposition: 'package' },
      '/package',
    );
    const mediaFileCount = raw['mediaFileCount'];
    const missingMediaCount = raw['missingMediaCount'];
    if (
      typeof mediaFileCount !== 'number' ||
      !Number.isInteger(mediaFileCount) ||
      mediaFileCount < 0 ||
      typeof missingMediaCount !== 'number' ||
      !Number.isInteger(missingMediaCount) ||
      missingMediaCount < 0
    ) {
      throw invalid('media counts must be non-negative integers.', '/package');
    }
    packageFacts = {
      bucketName: section.bucketName,
      objectKey: section.objectKey,
      contentType: section.contentType,
      byteSize: section.byteSize,
      checksumSha256: section.checksumSha256,
      mediaFileCount,
      missingMediaCount,
    };
  }

  return {
    outcome: body.outcome,
    ...(packageFacts === undefined ? {} : { package: packageFacts }),
    ...(typeof body.failureCode === 'string' ? { failureCode: body.failureCode } : {}),
  };
}

export function registerExportInternalRoutes(
  app: FastifyInstance,
  dependencies: ExportInternalRoutesDependencies,
): void {
  app.post('/internal/exports/:exportRequestId/snapshot', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);
    const exportRequestId = requireExportRequestId(request);

    const response = await dependencies.runExportSnapshot.execute(exportRequestId);

    request.log.info(
      {
        event: 'export.snapshot_served',
        exportRequestId,
        state: response.state,
        sections: response.sections.length,
        checkpoints: response.checkpoints.length,
      },
      'Export snapshot served',
    );

    return reply.status(200).send(response);
  });

  app.post('/internal/exports/:exportRequestId/checkpoints', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);
    const exportRequestId = requireExportRequestId(request);
    const body = requireCheckpointBody(request);

    const summary = await dependencies.recordExportCheckpoints.execute(exportRequestId, body);

    request.log.info(
      {
        event: 'export.checkpoints_recorded',
        exportRequestId,
        sectionsRecorded: summary.sectionsRecorded,
      },
      'Export checkpoints recorded',
    );

    return reply.status(200).send(summary);
  });

  app.post('/internal/exports/:exportRequestId/complete', async (request, reply) => {
    await dependencies.cloudTasksInvocationVerifier.verify(request.headers.authorization);
    const exportRequestId = requireExportRequestId(request);
    const body = requireCompletionBody(request);

    const summary = await dependencies.completeExport.execute(exportRequestId, body);

    request.log.info(
      {
        event: 'export.completed_recorded',
        exportRequestId,
        outcome: body.outcome,
        state: summary.state,
        transitioned: summary.transitioned,
      },
      'Export completion recorded',
    );

    return reply.status(200).send(summary);
  });
}
