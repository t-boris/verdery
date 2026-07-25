/**
 * `RequestExport` (P8-EXPORT-01): records the durable export request and
 * schedules asynchronous generation — architecture/data-export-and-
 * deletion.md sections 4-6's authorized-request step.
 *
 * AUTHORIZATION, per scope (section 4):
 * - `account`: the requester exports their own personal data plus the
 *   gardens they OWN; the gate is recent authentication (section 5),
 *   checked against the session's own `auth_time` — never a client claim.
 * - `garden`: `exportGarden` capability (owner only — the capability
 *   matrix is the control point section 4 names for per-role export
 *   rights).
 *
 * RATE LIMIT: one active (`requested`/`running`) export per requester —
 * pre-checked inside the transaction for the friendly error, enforced by
 * the `export_request_one_active_per_requester` partial unique index for
 * the race, translated by constraint name to the same `409`.
 *
 * The `export.requested` outbox event commits atomically with the insert;
 * the workers relay enqueues the generation task from it. The
 * `export_package` media id and its exports-bucket object key are minted
 * HERE (see the migration's header for why the object key must embed the
 * media UUID before the media record can exist).
 */

import type { ExportRequest as ExportRequestResource } from '@verdery/api-contracts';
import {
  EXPORT_REQUESTED_EVENT_TYPE,
  type ExportRequestedEventPayload,
} from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { ActorContext } from '../../../shared/actor/actor-context.js';
import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { MediaStorageBucketNames } from '../../media/public.js';
import { generateObjectKey } from '../../media/public.js';
import {
  assertRecentAuthenticationForAccountExport,
  createExportRequest,
  type ExportScope,
} from '../domain/export-request.js';
import { activeExportExistsError } from './export-errors.js';
import { toExportRequestResource } from './export-view.js';
import type { ExportsUnitOfWork } from './exports-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const ONE_ACTIVE_INDEX_NAME = 'export_request_one_active_per_requester';

export interface RequestExportInput {
  readonly scope: ExportScope;
  readonly gardenId: Uuid | null;
  readonly includeMedia: boolean;
}

export class RequestExport {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: ExportsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly bucketNames: MediaStorageBucketNames,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    input: RequestExportInput,
    idempotencyKey: string,
  ): Promise<ExportRequestResource> {
    const now = this.clock.now();

    if (input.scope === 'account') {
      assertRecentAuthenticationForAccountExport(actor.authenticatedAt, now);
    } else {
      // Non-membership concealed as garden not-found, insufficient role as
      // forbidden — `GardenAuthorization`'s own posture.
      await this.authorization.requireCapability(
        input.gardenId as Uuid,
        actor.profileId,
        'exportGarden',
      );
    }

    try {
      return await runIdempotentCommand(
        this.idempotency,
        this.unitOfWork,
        {
          actorProfileId: actor.profileId,
          operation: 'exports.request',
          idempotencyKey,
          requestFingerprint: JSON.stringify([input.scope, input.gardenId, input.includeMedia]),
        },
        201,
        async (context) => {
          const active = await context.exportRequests.findActiveForRequester(actor.profileId);
          if (active !== null) {
            throw activeExportExistsError();
          }

          const outputMediaId = generateUuidV7();
          const request = createExportRequest(
            {
              id: generateUuidV7(),
              requesterProfileId: actor.profileId,
              scope: input.scope,
              gardenId: input.gardenId,
              includeMedia: input.includeMedia,
              sessionCredentialKind: actor.credentialKind,
              sessionAuthenticatedAt: actor.authenticatedAt,
              outputMediaId,
              packageBucketName: this.bucketNames.exports,
              packageObjectKey: generateObjectKey(outputMediaId),
            },
            now,
          );

          await context.exportRequests.insert(request);

          const payload: ExportRequestedEventPayload = {
            exportRequestId: request.id,
            requesterProfileId: request.requesterProfileId,
            scope: request.scope,
            gardenId: request.gardenId,
            includeMedia: request.includeMedia,
          };
          await context.outbox.append({
            eventType: EXPORT_REQUESTED_EVENT_TYPE,
            aggregateType: 'export_request',
            aggregateId: request.id,
            payload,
            traceId: actor.requestId,
          });

          return toExportRequestResource(request);
        },
      );
    } catch (error) {
      // The race the pre-check cannot catch: two concurrent requests both
      // saw no active export; the partial unique index decided.
      if (isUniqueViolation(error) && postgresConstraintName(error) === ONE_ACTIVE_INDEX_NAME) {
        throw activeExportExistsError();
      }
      throw error;
    }
  }
}
