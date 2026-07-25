/**
 * Media HTTP routes.
 *
 * Hand-written request validation against the same rules
 * `packages/api-contracts/openapi.yaml`'s `Media` tag declares — not derived
 * from it automatically, matching every other transport layer in this
 * codebase (see `gardens-mapping/transport/garden-routes.ts`'s own header
 * comment for the full rationale).
 *
 * P6-OBS-01: the three lifecycle-transition routes (register, complete,
 * delete) each emit one structured log line per request — media id, class,
 * outcome, and byte/duration figures only, never filenames, URLs, or
 * content (architecture/media-storage-and-processing.md section 19) —
 * following `sync-routes.ts`'s own P5-OBS-01 transport-layer precedent:
 * every field needed already crosses this boundary in the returned
 * resource, and `request.log` already carries `correlationId`. Reads
 * (status, access, list) deliberately log nothing here: they are ordinary
 * request-rate signals the platform's own HTTP telemetry already covers.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Media`;
 * implementation-plan.md work packages P6-API-01, P6-OBS-01.
 */

import type {
  Media,
  MediaAccess,
  MediaListResult,
  MediaRetentionPolicyResult,
  MediaUploadSession,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER, SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type { CompleteMediaUpload } from '../application/complete-media-upload.js';
import type { DeleteGardenMedia } from '../application/delete-garden-media.js';
import type { GetMediaAccess } from '../application/get-media-access.js';
import type { GetMediaRetentionPolicy } from '../application/get-media-retention-policy.js';
import type { GetMediaStatus } from '../application/get-media-status.js';
import type { ListGardenMedia } from '../application/list-garden-media.js';
import type { MediaClass } from '../domain/media-record.js';
import type { RegisterMediaUpload } from '../application/register-media-upload.js';

export interface MediaRoutesDependencies {
  readonly registerMediaUpload: RegisterMediaUpload;
  readonly completeMediaUpload: CompleteMediaUpload;
  readonly getMediaStatus: GetMediaStatus;
  readonly getMediaAccess: GetMediaAccess;
  readonly listGardenMedia: ListGardenMedia;
  readonly deleteGardenMedia: DeleteGardenMedia;
  readonly getMediaRetentionPolicy: GetMediaRetentionPolicy;
}

const MEDIA_CLASSES: readonly MediaClass[] = [
  'garden_photo',
  'imported_plan',
  'raw_capture',
  'derived_preview',
  'processing_output',
  'export_package',
];
const MAX_DISPLAY_FILENAME_LENGTH = 255;
const CHECKSUM_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
// The shared `Limit` parameter's own bounds and default (openapi.yaml),
// matching `garden-routes.ts`'s list parsing exactly.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requireGardenId(request: FastifyRequest): string {
  const { gardenId } = request.params as { gardenId?: unknown };

  if (typeof gardenId !== 'string' || !UUID_PATTERN.test(gardenId)) {
    throw invalid('gardenId must be a UUID.', 'request.garden_id.invalid', '/gardenId');
  }

  return gardenId;
}

function requireMediaId(request: FastifyRequest): string {
  const { mediaId } = request.params as { mediaId?: unknown };

  if (typeof mediaId !== 'string' || !UUID_PATTERN.test(mediaId)) {
    throw invalid('mediaId must be a UUID.', 'request.media_id.invalid', '/mediaId');
  }

  return mediaId;
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

function requireExpectedRevision(request: FastifyRequest): number {
  const raw = request.headers[IF_MATCH_HEADER];
  const unquoted = typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : '';
  const revision = Number(unquoted);

  if (typeof raw !== 'string' || !Number.isInteger(revision) || revision < 1) {
    throw invalid(
      `${IF_MATCH_HEADER} header must be a quoted positive integer revision.`,
      'request.if_match.invalid',
      `/headers/${IF_MATCH_HEADER}`,
    );
  }

  return revision;
}

interface ListGardenMediaQuery {
  readonly mediaClass: MediaClass | null;
  readonly cursor: string | null;
  readonly limit: number;
}

function parseListQuery(request: FastifyRequest): ListGardenMediaQuery {
  const query = request.query as { mediaClass?: unknown; cursor?: unknown; limit?: unknown };

  let mediaClass: MediaClass | null = null;
  if (query.mediaClass !== undefined) {
    if (
      typeof query.mediaClass !== 'string' ||
      !MEDIA_CLASSES.includes(query.mediaClass as MediaClass)
    ) {
      throw invalid(
        'mediaClass must be a known media class.',
        'request.media_class.invalid',
        '/mediaClass',
      );
    }
    mediaClass = query.mediaClass as MediaClass;
  }

  const cursor = typeof query.cursor === 'string' && query.cursor.length > 0 ? query.cursor : null;

  if (query.limit === undefined) {
    return { mediaClass, cursor, limit: DEFAULT_LIMIT };
  }
  const limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid(
      `limit must be between 1 and ${String(MAX_LIMIT)}.`,
      'request.limit.invalid',
      '/limit',
    );
  }

  return { mediaClass, cursor, limit };
}

interface RegisterMediaUploadBody {
  readonly mediaClass: MediaClass;
  readonly displayFilename: string;
  readonly declaredContentType: string;
  readonly declaredByteSize: number;
  readonly checksumSha256?: string | null;
}

function requireRegisterMediaUploadBody(request: FastifyRequest): RegisterMediaUploadBody {
  const body = request.body as Partial<RegisterMediaUploadBody> | undefined;

  if (typeof body?.mediaClass !== 'string' || !MEDIA_CLASSES.includes(body.mediaClass)) {
    throw invalid(
      'mediaClass must be a known media class.',
      'request.media_class.invalid',
      '/mediaClass',
    );
  }
  if (
    typeof body.displayFilename !== 'string' ||
    body.displayFilename.length === 0 ||
    body.displayFilename.length > MAX_DISPLAY_FILENAME_LENGTH
  ) {
    throw invalid(
      'displayFilename is required and must be 1-255 characters.',
      'request.display_filename.invalid',
      '/displayFilename',
    );
  }
  if (typeof body.declaredContentType !== 'string' || body.declaredContentType.length === 0) {
    throw invalid(
      'declaredContentType is required.',
      'request.declared_content_type.invalid',
      '/declaredContentType',
    );
  }
  if (
    typeof body.declaredByteSize !== 'number' ||
    !Number.isInteger(body.declaredByteSize) ||
    body.declaredByteSize < 1
  ) {
    throw invalid(
      'declaredByteSize must be a positive integer.',
      'request.declared_byte_size.invalid',
      '/declaredByteSize',
    );
  }
  if (
    body.checksumSha256 !== undefined &&
    body.checksumSha256 !== null &&
    (typeof body.checksumSha256 !== 'string' || !CHECKSUM_SHA256_PATTERN.test(body.checksumSha256))
  ) {
    throw invalid(
      'checksumSha256 must be 64 lowercase hexadecimal characters.',
      'request.checksum_sha256.invalid',
      '/checksumSha256',
    );
  }

  return {
    mediaClass: body.mediaClass,
    displayFilename: body.displayFilename,
    declaredContentType: body.declaredContentType,
    declaredByteSize: body.declaredByteSize,
    checksumSha256: body.checksumSha256 ?? null,
  };
}

export function registerMediaRoutes(
  app: FastifyInstance,
  dependencies: MediaRoutesDependencies,
): void {
  app.get('/gardens/:gardenId/media', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const { mediaClass, cursor, limit } = parseListQuery(request);

    const result: MediaListResult = await dependencies.listGardenMedia.execute(
      gardenId,
      request.actorContext.profileId,
      mediaClass,
      cursor,
      limit,
    );

    return reply.status(200).send(result);
  });

  app.post('/gardens/:gardenId/media', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = requireRegisterMediaUploadBody(request);

    const session: MediaUploadSession = await dependencies.registerMediaUpload.execute(
      gardenId,
      request.actorContext.profileId,
      body,
      idempotencyKey,
    );

    request.log.info(
      {
        event: 'media.upload.registered',
        mediaId: session.media.id,
        mediaClass: session.media.mediaClass,
        declaredByteSize: session.media.declaredByteSize,
      },
      'Media upload registered',
    );

    return reply.status(201).send(session);
  });

  app.get('/gardens/:gardenId/media/:mediaId', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const mediaId = requireMediaId(request);

    const media: Media = await dependencies.getMediaStatus.execute(
      gardenId,
      mediaId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(media);
  });

  app.post('/gardens/:gardenId/media/:mediaId/complete', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const mediaId = requireMediaId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const media: Media = await dependencies.completeMediaUpload.execute(
      gardenId,
      mediaId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    // `outcome` is `available` or `rejected` — the only two states this
    // command returns (any other state throws before reaching here).
    // `registrationToCompletionMs` uses the server-stamped transition times
    // on the resource itself, so it is exact on the request that performed
    // the transition; a rare idempotent replay re-logs the record's current
    // timestamps instead (documented in observability-and-analytics.md
    // section 13's media subsection).
    request.log.info(
      {
        event: 'media.upload.completed',
        mediaId: media.id,
        mediaClass: media.mediaClass,
        outcome: media.uploadState,
        registrationToCompletionMs: Math.max(
          0,
          Date.parse(media.updatedAt) - Date.parse(media.createdAt),
        ),
        ...(media.verifiedByteSize === null ? {} : { verifiedByteSize: media.verifiedByteSize }),
      },
      'Media upload completion verified',
    );

    return reply.status(200).send(media);
  });

  app.get('/gardens/:gardenId/media/:mediaId/access', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const mediaId = requireMediaId(request);

    const access: MediaAccess = await dependencies.getMediaAccess.execute(
      gardenId,
      mediaId,
      request.actorContext.profileId,
    );

    return reply.status(200).send(access);
  });

  // POST sub-resource action, not HTTP DELETE — the same reasoning
  // `deleteTask`'s contract description documents: a governed state
  // transition on a surviving row, not a hard delete (P6-RET-01).
  app.post('/gardens/:gardenId/media/:mediaId/delete', async (request, reply) => {
    const gardenId = requireGardenId(request);
    const mediaId = requireMediaId(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedRevision = requireExpectedRevision(request);

    const media: Media = await dependencies.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      request.actorContext.profileId,
      expectedRevision,
      idempotencyKey,
    );

    // The USER-initiated half of deletion scheduling; sweep-initiated
    // scheduling is counted by `retention.sweep_completed` (workers). The
    // completion side (`deletion_scheduled -> deleted`, with the computed
    // lag) is `media.processing.result_recorded`'s `deletionLagMs`.
    // `uploadState` is `deletion_scheduled` on the scheduling request
    // itself, or `deleted` on an idempotent replay after completion.
    request.log.info(
      {
        event: 'media.deletion.scheduled',
        mediaId: media.id,
        mediaClass: media.mediaClass,
        uploadState: media.uploadState,
      },
      'Media deletion scheduled',
    );

    return reply.status(200).send(media);
  });

  // Product-wide static policy — authenticated but not garden-scoped
  // (P6-RET-01); see the contract operation's own description.
  app.get('/media/retention-policy', async (_request, reply) => {
    const policy: MediaRetentionPolicyResult = dependencies.getMediaRetentionPolicy.execute();

    return reply.status(200).send(policy);
  });
}
